import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DailyMetricsDigest, InsightMetric } from "@/lib/types";
import { getActiveStores } from "@/lib/server/active-stores-cache";

/**
 * Deterministic daily performance digest — no AI involved.
 *
 * This used to be the signal layer feeding an AI-narrated brief
 * (`generate-daily-insight.ts` called Gemini to write a headline/narrative on
 * top of these numbers). That generation was retired in favor of ERP's own
 * AI brief; this file is what's left — the same metric computation, now
 * written straight to Firestore as `stores/{storeId}/dailyMetrics/{dayId}`
 * for ERP to pull. See docs/erp-daily-metrics-forwarding.md for the full
 * inventory of what's measured here.
 *
 * Runs for every active store — no longer gated by the `aiEnabled` flag
 * (that flag now only matters to the AI features POS still owns: sales
 * forecasting and holiday-calendar generation).
 */

// Max NEW (not-yet-done) stores computed per cron fire. With several off-peak
// fires + per-store skip-if-done, the work spreads into small batches and no
// store is ever computed twice in a day.
const DIGEST_CONCURRENCY = 2;
const DIGEST_BATCH = 4;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ----------------------------- date helpers ----------------------------- */

/** YYYYMMDD for a Date in Asia/Manila (matches how analytics docs are keyed). */
function manilaParts(d: Date): { y: number; m: number; day: number; dow: number } {
  const s = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Manila",
  }).format(d); // YYYY-MM-DD
  const [y, m, day] = s.split("-").map(Number);
  // Day-of-week in Manila
  const dowStr = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Manila" }).format(d);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dowStr);
  return { y, m, day, dow };
}
function dayIdOf(d: Date): string {
  const { y, m, day } = manilaParts(d);
  return `${y}${String(m).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

/** The day the digest analyzes = yesterday (Asia/Manila), YYYYMMDD. */
export function getMetricsDayId(now: Date = new Date()): string {
  return dayIdOf(addDays(now, -1));
}

/* ----------------------------- format helpers --------------------------- */

const peso = (n: number) => `₱${Math.round(Number(n) || 0).toLocaleString()}`;
const minutes = (ms: number) => `${(Number(ms || 0) / 60000).toFixed(1)} min`;
const count = (n: number) => `${Math.round(Number(n) || 0).toLocaleString()}`;

function pct(cur: number, base: number): number | null {
  if (!base || base <= 0) return null;
  return ((cur - base) / base) * 100;
}
function dirOf(delta: number | null): "up" | "down" | "flat" | null {
  if (delta == null) return null;
  if (delta > 1) return "up";
  if (delta < -1) return "down";
  return "flat";
}
function deltaSub(cur: number, base: number | null, label: string): { sub: string | null; direction: "up" | "down" | "flat" | null } {
  if (base == null || base <= 0) return { sub: null, direction: null };
  const p = pct(cur, base)!;
  const sign = p >= 0 ? "+" : "";
  return { sub: `${sign}${p.toFixed(0)}% vs ${label}`, direction: dirOf(p) };
}

/* ----------------------------- metric extraction ------------------------ */

type DM = any; // DailyMetric (read defensively)

function sumVals(o: Record<string, number> | undefined): number {
  if (!o) return 0;
  return Object.values(o).reduce((a, b) => a + (Number(b) || 0), 0);
}
function topEntry(o: Record<string, number> | undefined): { key: string; val: number } | null {
  if (!o) return null;
  let best: { key: string; val: number } | null = null;
  for (const [k, v] of Object.entries(o)) {
    const n = Number(v) || 0;
    if (!best || n > best.val) best = { key: k, val: n };
  }
  return best;
}
function bottomEntry(o: Record<string, number> | undefined): { key: string; val: number } | null {
  if (!o) return null;
  let worst: { key: string; val: number } | null = null;
  for (const [k, v] of Object.entries(o)) {
    const n = Number(v) || 0;
    if (n <= 0) continue;
    if (!worst || n < worst.val) worst = { key: k, val: n };
  }
  return worst;
}
const grossOf = (dm: DM) => Number(dm?.payments?.totalGross ?? 0);
const txOf = (dm: DM) => Number(dm?.payments?.txCount ?? 0);
const coversOf = (dm: DM) => Number(dm?.guests?.guestCountFinalTotal ?? 0);
const leakageAmt = (dm: DM) =>
  Number(dm?.items?.voidedAmount ?? 0) + Number(dm?.items?.discountedAmount ?? 0) + Number(dm?.items?.freeAmount ?? 0);
const leakagePctOf = (dm: DM): number | null => {
  const g = grossOf(dm);
  return g > 0 ? (leakageAmt(dm) / g) * 100 : null;
};

/** 7-day momentum: recent-7 vs prior-7 avg, plus day-over-day rise/fall streak. */
function computeTrend(byOffset: Map<number, DM>): { trendPct: number | null; streakDir: 1 | -1 | 0; streakDays: number } {
  const g = (o: number) => { const d = byOffset.get(o); return d ? grossOf(d) : null; };
  const avgRange = (a: number, b: number) => {
    let s = 0, n = 0;
    for (let o = a; o <= b; o++) { const v = g(o); if (v != null && v > 0) { s += v; n++; } }
    return n ? s / n : null;
  };
  const recent = avgRange(1, 7), prior = avgRange(8, 14);
  const trendPct = recent != null && prior != null && prior > 0 ? ((recent - prior) / prior) * 100 : null;
  let dir: 1 | -1 | 0 = 0, days = 0;
  for (let o = 1; o <= 13; o++) {
    const a = g(o), b = g(o + 1);
    if (a == null || b == null) break;
    const cmp: 1 | -1 | 0 = a > b ? 1 : a < b ? -1 : 0;
    if (cmp === 0) break;
    if (dir === 0) { dir = cmp; days = 1; }
    else if (cmp === dir) days++;
    else break;
  }
  return { trendPct, streakDir: dir, streakDays: days };
}

/** Average comps-leakage % over the prior ~14 days (baseline for trending). */
function computeLeakageBaseline(byOffset: Map<number, DM>): number | null {
  let s = 0, n = 0;
  for (let o = 2; o <= 15; o++) { const d = byOffset.get(o); if (!d) continue; const p = leakagePctOf(d); if (p != null) { s += p; n++; } }
  return n ? s / n : null;
}

/** Per-local-user operations leaders (server confirm + kitchen serve) for yesterday. */
function computeStaffOps(yest: DM): { chips: InsightMetric[]; digest: string } {
  const names = (yest?.staffNames ?? {}) as Record<string, string>;
  const nm = (id: string) => names[id] || id.slice(0, 6);
  const chips: InsightMetric[] = [];
  const lines: string[] = [];

  const avgsFrom = (sum: Record<string, number> = {}, cnt: Record<string, number> = {}, minN = 3) =>
    Object.keys(cnt)
      .filter((id) => Number(cnt[id]) >= minN)
      .map((id) => ({ id, avg: Number(sum[id]) / Number(cnt[id]), n: Number(cnt[id]) }))
      .sort((a, b) => a.avg - b.avg);

  const servers = avgsFrom(yest?.server?.confirmMsSumByUser, yest?.server?.confirmCountByUser);
  if (servers.length) {
    const fast = servers[0];
    chips.push({ label: "Fastest to confirm", value: nm(fast.id), sub: `${minutes(fast.avg)} avg`, direction: null });
    lines.push(`- Fastest server confirm: ${nm(fast.id)} (${minutes(fast.avg)} avg over ${fast.n})`);
    if (servers.length > 1) { const slow = servers[servers.length - 1]; lines.push(`- Slowest server confirm: ${nm(slow.id)} (${minutes(slow.avg)} avg)`); }
  }
  const kitchen = avgsFrom(yest?.kitchen?.servingMsSumByUser, yest?.kitchen?.servingCountByUser);
  if (kitchen.length) {
    const fast = kitchen[0];
    chips.push({ label: "Fastest kitchen serve", value: nm(fast.id), sub: `${minutes(fast.avg)} avg`, direction: null });
    lines.push(`- Fastest kitchen serve: ${nm(fast.id)} (${minutes(fast.avg)} avg over ${fast.n})`);
  }

  const digest = lines.length ? ["STAFF (per local user)", ...lines].join("\n") : "";
  return { chips, digest };
}

/* ----------------------------- core builder ----------------------------- */

type BuiltInput = {
  sections: {
    sales: InsightMetric[];
    operations: InsightMetric[];
    inventory: InsightMetric[];
    anomalies: InsightMetric[];
  };
  digest: string;
};

type DigestExtras = {
  forecastProjected: number | null;
  trendPct: number | null;
  streakDir: 1 | -1 | 0;
  streakDays: number;
  leakageBaselinePct: number | null;
};

/** Exported for testing/diagnostics: builds the deterministic digest. Pure —
 *  takes analytics docs, does no I/O and calls no model. */
export function buildMetricsAndDigest(
  yest: DM,
  prevDay: DM | null,
  sameDowAvgGross: number | null,
  avg7Gross: number | null,
  sameDowAvgCovers: number | null,
  dowName: string,
  extras: DigestExtras,
): BuiltInput {
  const gross = grossOf(yest);
  const tx = txOf(yest);
  const covers = coversOf(yest);
  const basket = tx > 0 ? gross / tx : 0;
  const prevBasket = prevDay && txOf(prevDay) > 0 ? grossOf(prevDay) / txOf(prevDay) : null;

  const dineInTx = Number(yest?.payments?.txCountByMode?.dineIn ?? 0);
  const walkInTx = Number(yest?.payments?.txCountByMode?.walkIn ?? 0);
  const topPkg = topEntry(yest?.sales?.packageSalesAmountByName);
  const slowPkg = bottomEntry(yest?.sales?.packageSalesAmountByName);
  const peakHour = topEntry(yest?.sales?.salesAmountByHour);
  const topMethod = topEntry(yest?.payments?.byMethod);

  // Sales chips
  const sales: InsightMetric[] = [];
  {
    const vsPrev = deltaSub(gross, prevDay ? grossOf(prevDay) : null, "prev day");
    sales.push({ label: "Net sales", value: peso(gross), sub: vsPrev.sub, direction: vsPrev.direction });
    const vsDow = deltaSub(gross, sameDowAvgGross, `avg ${dowName}`);
    if (sameDowAvgGross != null) sales.push({ label: "vs same weekday", value: peso(sameDowAvgGross), sub: vsDow.sub, direction: vsDow.direction });
    if (avg7Gross != null) {
      const v7 = deltaSub(gross, avg7Gross, "7-day avg");
      sales.push({ label: "vs 7-day avg", value: peso(avg7Gross), sub: v7.sub, direction: v7.direction });
    }
    sales.push({ label: "Transactions", value: count(tx), sub: prevDay ? `${count(txOf(prevDay))} prev day` : null, direction: prevDay ? dirOf(pct(tx, txOf(prevDay))) : null });
    sales.push({ label: "Avg basket", value: peso(basket), sub: prevBasket != null ? deltaSub(basket, prevBasket, "prev day").sub : null, direction: prevBasket != null ? dirOf(pct(basket, prevBasket)) : null });
    sales.push({ label: "Covers", value: count(covers), sub: sameDowAvgCovers != null ? deltaSub(covers, sameDowAvgCovers, "weekday avg").sub : null, direction: sameDowAvgCovers != null ? dirOf(pct(covers, sameDowAvgCovers)) : null });
    sales.push({ label: "Dine-in / Walk-in", value: `${count(dineInTx)} / ${count(walkInTx)}`, sub: "transactions", direction: null });
    if (extras.forecastProjected != null && extras.forecastProjected > 0) {
      const vsFc = deltaSub(gross, extras.forecastProjected, "forecast");
      sales.push({ label: "vs forecast", value: peso(extras.forecastProjected), sub: vsFc.sub, direction: vsFc.direction });
    }
    if (extras.trendPct != null) {
      sales.push({ label: "7-day trend", value: `${extras.trendPct >= 0 ? "+" : ""}${extras.trendPct.toFixed(0)}%`, sub: "vs prior 7 days", direction: dirOf(extras.trendPct) });
    }
    if (topPkg) sales.push({ label: "Top package", value: topPkg.key, sub: peso(topPkg.val), direction: null });
    if (peakHour) sales.push({ label: "Peak hour", value: `${peakHour.key}:00`, sub: peso(peakHour.val), direction: null });
    if (topMethod) sales.push({ label: "Top payment", value: topMethod.key, sub: peso(topMethod.val), direction: null });
  }

  // Operations chips
  const operations: InsightMetric[] = [];
  {
    const confirmAvg = Number(yest?.server?.confirmCount ?? 0) > 0 ? Number(yest.server.confirmMsSum) / Number(yest.server.confirmCount) : null;
    const sessAvg = Number(yest?.sessions?.dineInDurationCount ?? 0) > 0 ? Number(yest.sessions.dineInDurationMsSum) / Number(yest.sessions.dineInDurationCount) : null;
    const serveSum = sumVals(yest?.kitchen?.durationMsSumByType);
    const serveCnt = sumVals(yest?.kitchen?.durationCountByType);
    const serveAvg = serveCnt > 0 ? serveSum / serveCnt : null;
    const busyHour = topEntry(yest?.sales?.sessionCountByHour);
    const cancels = sumVals(yest?.kitchen?.cancelledCountByType);
    if (confirmAvg != null) operations.push({ label: "Avg time to attend", value: minutes(confirmAvg), sub: "seat → server confirm", direction: null });
    if (sessAvg != null) operations.push({ label: "Avg dine-in session", value: minutes(sessAvg), sub: null, direction: null });
    if (serveAvg != null) operations.push({ label: "Avg kitchen serve", value: minutes(serveAvg), sub: `${count(serveCnt)} served`, direction: null });
    if (busyHour) operations.push({ label: "Busiest hour", value: `${busyHour.key}:00`, sub: `${count(busyHour.val)} sessions`, direction: null });
    operations.push({ label: "Sessions closed", value: count(yest?.sessions?.closedCount ?? 0), sub: null, direction: null });
    if (cancels > 0) operations.push({ label: "Kitchen cancels", value: count(cancels), sub: null, direction: null });
  }

  // Inventory (sell-through) chips
  const inventory: InsightMetric[] = [];
  {
    const addonQty: Record<string, number> = {};
    const byItem = yest?.sales?.addonSalesByItem as Record<string, { qty: number }> | undefined;
    if (byItem) for (const [k, v] of Object.entries(byItem)) addonQty[k] = Number(v?.qty || 0);
    const topAddon = topEntry(addonQty);
    const slowAddon = bottomEntry(addonQty);
    const topRefill = topEntry(yest?.refills?.servedRefillsByName);
    const topPkgQty = topEntry(yest?.sales?.packageSalesQtyByName);
    if (topAddon) inventory.push({ label: "Fastest add-on", value: topAddon.key, sub: `${count(topAddon.val)} sold`, direction: null });
    if (slowAddon && slowAddon.key !== topAddon?.key) inventory.push({ label: "Slowest add-on", value: slowAddon.key, sub: `${count(slowAddon.val)} sold`, direction: null });
    if (topRefill) inventory.push({ label: "Top refill", value: topRefill.key, sub: `${count(topRefill.val)} served`, direction: null });
    if (topPkgQty) inventory.push({ label: "Top package (qty)", value: topPkgQty.key, sub: `${count(topPkgQty.val)} sold`, direction: null });
  }

  // Anomalies chips
  const anomalies: InsightMetric[] = [];
  {
    const voided = Number(yest?.items?.voidedAmount ?? 0);
    const discounted = Number(yest?.items?.discountedAmount ?? 0);
    const free = Number(yest?.items?.freeAmount ?? 0);
    const refundTotal = Number(yest?.items?.refundTotal ?? 0);
    const refundCount = Number(yest?.items?.refundCount ?? 0);
    const charges = Number(yest?.payments?.chargesTotal ?? 0);
    // No-guest hours within the active window (first→last hour with any session).
    const sch = (yest?.sales?.sessionCountByHour ?? {}) as Record<string, number>;
    const hours = Object.keys(sch).map(Number).filter((h) => Number(sch[String(h)]) > 0).sort((a, b) => a - b);
    let noGuestHours = 0;
    if (hours.length >= 2) {
      for (let h = hours[0]; h <= hours[hours.length - 1]; h++) if (!(Number(sch[String(h)]) > 0)) noGuestHours++;
    }
    const ofSales = (amt: number) => (gross > 0 ? ` · ${((amt / gross) * 100).toFixed(1)}% of sales` : "");
    if (voided > 0) anomalies.push({ label: "Voided", value: peso(voided), sub: `${count(yest?.items?.voidedQty ?? 0)} items${ofSales(voided)}`, direction: null });
    if (discounted > 0) anomalies.push({ label: "Discounts", value: peso(discounted), sub: `${count(yest?.items?.discountedQty ?? 0)} items${ofSales(discounted)}`, direction: null });
    if (free > 0) anomalies.push({ label: "Free items", value: peso(free), sub: `${count(yest?.items?.freeQty ?? 0)} items${ofSales(free)}`, direction: null });
    if (refundCount > 0) anomalies.push({ label: "Refunds", value: peso(refundTotal), sub: `${count(refundCount)} refund(s)`, direction: null });
    // Combined comps/leakage rate vs the 14-day baseline.
    const leakTotal = voided + discounted + free;
    const leakPct = gross > 0 ? (leakTotal / gross) * 100 : null;
    if (leakPct != null && leakTotal > 0) {
      const base = extras.leakageBaselinePct;
      const sub = base != null
        ? `${leakPct - base >= 0 ? "+" : ""}${(leakPct - base).toFixed(1)} pts vs ${base.toFixed(1)}% avg`
        : "of sales (void+disc+free)";
      const direction = base != null ? (leakPct > base + 0.3 ? "up" : leakPct < base - 0.3 ? "down" : "flat") : null;
      anomalies.push({ label: "Comps & leakage", value: `${leakPct.toFixed(1)}%`, sub, direction });
    }
    if (charges > 0) anomalies.push({ label: "Extra charges", value: peso(charges), sub: null, direction: null });
    if (noGuestHours > 0) anomalies.push({ label: "Idle hours (within open window)", value: count(noGuestHours), sub: "no sessions", direction: "down" });
  }

  // Digest text — a free byproduct of the chips above, handy for
  // forwarding/logging without re-deriving meaning from the arrays.
  const line = (m: InsightMetric) => `- ${m.label}: ${m.value}${m.sub ? ` (${m.sub})` : ""}`;
  const streakLine = extras.streakDays >= 2 && extras.streakDir !== 0
    ? `- Momentum: sales ${extras.streakDir > 0 ? "rose" : "fell"} ${extras.streakDays} days in a row (through yesterday)`
    : "";
  const digest = [
    "SALES",
    ...sales.map(line),
    slowPkg && slowPkg.key !== topPkg?.key ? `- Lowest-selling package: ${slowPkg.key} (${peso(slowPkg.val)})` : "",
    streakLine,
    "",
    "OPERATIONS",
    ...operations.map(line),
    "",
    "INVENTORY (menu-item sell-through, not raw stock)",
    ...inventory.map(line),
    inventory.length === 0 ? "- No add-on/refill movement recorded." : "",
    "",
    "ANOMALIES / WATCH",
    ...anomalies.map(line),
    anomalies.length === 0 ? "- No notable voids, discounts, refunds, or idle gaps." : "",
  ].filter(Boolean).join("\n");

  return { sections: { sales, operations, inventory, anomalies }, digest };
}

/**
 * Staff responsiveness to customer "need assistance" taps (customer app) for
 * yesterday — count, answered/unanswered, avg & slowest response, % within 2 min.
 * Source: stores/{id}/customerRequests (same data as admin/customer-requests).
 */
async function buildAssistanceMetrics(
  storeId: string,
  now: Date,
  yesterday: Date,
): Promise<{ chips: InsightMetric[]; digest: string }> {
  const db = getAdminDb();
  const manilaDayStartMs = (d: Date): number => {
    const s = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Manila" }).format(d);
    return new Date(`${s}T00:00:00+08:00`).getTime();
  };
  const start = manilaDayStartMs(yesterday);
  const end = manilaDayStartMs(now); // today's midnight = end of yesterday
  const snap = await db
    .collection(`stores/${storeId}/customerRequests`)
    .where("createdAtClientMs", ">=", start)
    .where("createdAtClientMs", "<", end)
    .get();

  const rows = snap.docs.map((d) => d.data() as any);
  if (rows.length === 0) return { chips: [], digest: "" };

  const total = rows.length;
  const doneRows = rows.filter((r) => r.status === "done");
  const pending = total - doneRows.length;
  let sum = 0, cnt = 0, maxMs = 0, under2 = 0;
  for (const r of doneRows) {
    const doneMs = typeof r.doneAtClientMs === "number" ? r.doneAtClientMs : (r.doneAt?.toMillis ? r.doneAt.toMillis() : null);
    if (doneMs == null) continue;
    const ms = Math.max(0, doneMs - Number(r.createdAtClientMs || 0));
    sum += ms; cnt += 1;
    if (ms > maxMs) maxMs = ms;
    if (ms <= 120000) under2 += 1;
  }
  const avgMs = cnt > 0 ? sum / cnt : null;
  const within2Pct = cnt > 0 ? Math.round((under2 / cnt) * 100) : null;

  // Who answered the most (per local user).
  const byHandler: Record<string, number> = {};
  for (const r of doneRows) {
    const h = r.doneByProfileName || r.doneByUsername;
    if (h) byHandler[h] = (byHandler[h] || 0) + 1;
  }
  const topHandler = topEntry(byHandler);

  const chips: InsightMetric[] = [
    { label: "Assistance requests", value: count(total), sub: `${count(doneRows.length)} answered${pending > 0 ? `, ${count(pending)} unanswered` : ""}`, direction: pending > 0 ? "down" : null },
  ];
  if (avgMs != null) chips.push({ label: "Avg response", value: minutes(avgMs), sub: "tap → done", direction: null });
  if (maxMs > 0) chips.push({ label: "Slowest response", value: minutes(maxMs), sub: null, direction: null });
  if (within2Pct != null) chips.push({ label: "Answered ≤2 min", value: `${within2Pct}%`, sub: null, direction: within2Pct < 80 ? "down" : null });
  if (topHandler) chips.push({ label: "Most assists handled", value: topHandler.key, sub: `${count(topHandler.val)} handled`, direction: null });

  const digest = [
    "ASSISTANCE / RESPONSIVENESS (customer 'need assistance' taps)",
    `- Requests: ${total} (${doneRows.length} answered${pending > 0 ? `, ${pending} unanswered` : ""})`,
    avgMs != null ? `- Avg response (tap → done): ${minutes(avgMs)}` : "",
    maxMs > 0 ? `- Slowest response: ${minutes(maxMs)}` : "",
    within2Pct != null ? `- Answered within 2 min: ${within2Pct}%` : "",
    topHandler ? `- Most handled by: ${topHandler.key} (${topHandler.val})` : "",
  ].filter(Boolean).join("\n");

  return { chips, digest };
}

/* ----------------------------- main entry ------------------------------- */

type StoreData = { id: string; name?: string; isActive?: boolean };

export async function computeDailyMetricsForStore(
  store: StoreData,
  source: "manual" | "cron" = "manual",
  opts: { force?: boolean } = {},
): Promise<{ storeId: string; ok: boolean; status?: string; error?: string; skipped?: boolean }> {
  const db = getAdminDb();

  const now = new Date();
  const yesterday = addDays(now, -1);
  const dayId = dayIdOf(yesterday);
  const digestRef = db.doc(`stores/${store.id}/dailyMetrics/${dayId}`);

  // A store already computed today needs no repeat work.
  if (!opts.force) {
    const existing = await digestRef.get();
    const st = existing.exists ? (existing.data() as any)?.status : null;
    if (st === "ok" || st === "no_data") {
      return { storeId: store.id, ok: true, status: st, skipped: true };
    }
  }

  try {
    // Read yesterday + prior 20 days by id (deterministic batch).
    const offsets = Array.from({ length: 21 }, (_, i) => i + 1); // 1..21 days ago
    const refs = offsets.map((o) => db.doc(`stores/${store.id}/analytics/${dayIdOf(addDays(now, -o))}`));
    const snaps = await db.getAll(...refs);
    const byOffset = new Map<number, DM>();
    snaps.forEach((s, i) => { if (s.exists) byOffset.set(offsets[i], s.data()); });

    const yest = byOffset.get(1);
    if (!yest || grossOf(yest) <= 0) {
      const doc: DailyMetricsDigest = {
        dayId, storeId: store.id, status: "no_data", source,
        generatedAt: FieldValue.serverTimestamp(), generatedAtMs: Date.now(),
        sales: [], operations: [], inventory: [], anomalies: [], error: null,
      };
      await digestRef.set(doc);
      return { storeId: store.id, ok: true, status: "no_data" };
    }

    const prevDay = byOffset.get(2) ?? null;
    const yDow = manilaParts(yesterday).dow;
    // same-weekday samples among offsets 2..21
    const sameDow: DM[] = [];
    const last7: DM[] = [];
    for (const o of offsets) {
      if (o === 1) continue;
      const dm = byOffset.get(o);
      if (!dm) continue;
      if (manilaParts(addDays(now, -o)).dow === yDow) sameDow.push(dm);
      if (o >= 2 && o <= 8) last7.push(dm);
    }
    const avg = (arr: DM[], pick: (d: DM) => number) => (arr.length ? arr.reduce((a, d) => a + pick(d), 0) / arr.length : null);
    const sameDowAvgGross = avg(sameDow, grossOf);
    const avg7Gross = avg(last7, grossOf);
    const sameDowAvgCovers = avg(sameDow, coversOf);

    // Momentum + comps baseline from the loaded history.
    const { trendPct, streakDir, streakDays } = computeTrend(byOffset);
    const leakageBaselinePct = computeLeakageBaseline(byOffset);

    // Forecast vs actual — closes the loop with the sales forecaster (still
    // AI-generated in POS; unaffected by this retirement).
    const yp = manilaParts(yesterday);
    const yMd = `${yp.y}-${String(yp.m).padStart(2, "0")}-${String(yp.day).padStart(2, "0")}`;
    let forecastProjected: number | null = null;
    try {
      const fc = await db.doc(`stores/${store.id}/salesForecasts/${yMd}`).get();
      if (fc.exists) forecastProjected = Number((fc.data() as any)?.projectedSales ?? 0) || null;
    } catch { /* forecast optional */ }

    const extras: DigestExtras = { forecastProjected, trendPct, streakDir, streakDays, leakageBaselinePct };
    const { sections, digest } = buildMetricsAndDigest(yest, prevDay, sameDowAvgGross, avg7Gross, sameDowAvgCovers, DAY_NAMES[yDow], extras);

    const staffOps = computeStaffOps(yest);
    const assistance = await buildAssistanceMetrics(store.id, now, yesterday).catch(() => ({ chips: [] as InsightMetric[], digest: "" }));

    // Per-staff leaders + assistance responsiveness both belong in operations.
    const operations = [...sections.operations, ...staffOps.chips, ...assistance.chips];
    const digestText = [digest, staffOps.digest, assistance.digest].filter(Boolean).join("\n\n");

    const doc: DailyMetricsDigest = {
      dayId, storeId: store.id, status: "ok", source,
      generatedAt: FieldValue.serverTimestamp(), generatedAtMs: Date.now(),
      sales: sections.sales,
      operations,
      inventory: sections.inventory,
      anomalies: sections.anomalies,
      digestText,
      error: null,
    };
    await digestRef.set(doc);
    return { storeId: store.id, ok: true, status: "ok" };
  } catch (err: any) {
    console.error(`[computeDailyMetricsForStore] store=${store.id} failed:`, err);
    return { storeId: store.id, ok: false, error: err?.message || String(err) };
  }
}

/* ----------------------------- all-stores + run-log (for cron) ---------- */

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function computeDailyMetricsForAllActiveStores(opts: { batchSize?: number } = {}) {
  const db = getAdminDb();
  const dayId = getMetricsDayId();
  const activeStores = await getActiveStores(db);
  // Every active store — no longer gated by `aiEnabled` (that flag now only
  // gates the AI features POS still owns: forecasting and holiday calendars).
  const stores: StoreData[] = activeStores.map((s) => ({ id: s.id, name: s.name, isActive: s.isActive }));
  if (stores.length === 0) return { totalStores: 0, pending: 0, processed: 0, remaining: 0, results: [] as Awaited<ReturnType<typeof computeDailyMetricsForStore>>[] };

  // Skip stores already done today (output doc ok/no_data).
  const doneSnaps = await db.getAll(...stores.map((s) => db.doc(`stores/${s.id}/dailyMetrics/${dayId}`)));
  const pending = stores.filter((_, i) => {
    const st = doneSnaps[i].exists ? (doneSnaps[i].data() as any)?.status : null;
    return !(st === "ok" || st === "no_data");
  });

  // Process only a batch of pending stores per fire (the rest wait for the next
  // off-peak fire), keeping each burst small.
  const slice = opts.batchSize ? pending.slice(0, opts.batchSize) : pending;
  const results = await mapWithConcurrency(slice, DIGEST_CONCURRENCY, (s) => computeDailyMetricsForStore(s, "cron"));
  return {
    totalStores: stores.length,
    pending: pending.length,
    processed: slice.length,
    remaining: pending.length - slice.length,
    results,
  };
}

function getManilaDateStr(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Manila" }).format(new Date());
}
const CRON_LOG_DOC = "system/dailyMetricsCronLog";
const MAX_DAILY_ATTEMPTS = 5;

export async function runDailyMetricsWithTracking(): Promise<{ skipped: boolean; reason: string; result?: Awaited<ReturnType<typeof computeDailyMetricsForAllActiveStores>> }> {
  const db = getAdminDb();
  const dateStr = getManilaDateStr();
  const logDoc = await db.doc(CRON_LOG_DOC).get();
  const runs = (logDoc.exists ? logDoc.data()?.runs : {}) ?? {};
  const log = runs[dateStr] as { status: string; attempts: number } | undefined;
  if (log?.status === "success") return { skipped: true, reason: "Already succeeded today." };
  if ((log?.attempts ?? 0) >= MAX_DAILY_ATTEMPTS) return { skipped: true, reason: "Max attempts reached." };

  const attempts = (log?.attempts ?? 0) + 1;
  try {
    const result = await computeDailyMetricsForAllActiveStores({ batchSize: DIGEST_BATCH });
    const batchOk = result.results.every((r) => r.ok);
    // "success" only when no stores remain pending AND this batch had no errors;
    // otherwise stay "pending" so the next off-peak fire picks up the rest /
    // retries failures (capped by MAX_DAILY_ATTEMPTS).
    const allDone = result.remaining === 0 && batchOk;
    await db.doc(CRON_LOG_DOC).set(
      { runs: { [dateStr]: { status: allDone ? "success" : "pending", attempts, lastAttemptAt: Timestamp.now() } } },
      { merge: true },
    );
    return {
      skipped: false,
      reason: allDone ? "All metrics computed." : `Processed ${result.processed}; ${result.remaining} store(s) remaining.`,
      result,
    };
  } catch (err) {
    await db.doc(CRON_LOG_DOC).set({ runs: { [dateStr]: { status: "failed", attempts, lastAttemptAt: Timestamp.now() } } }, { merge: true });
    throw err;
  }
}
