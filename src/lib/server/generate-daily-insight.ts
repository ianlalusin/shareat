import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { generateDailyInsight as runDailyInsightFlow } from "@/ai/flows/daily-insight";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type {
  DailyInsight,
  InsightMetric,
  InsightSectionData,
  DailyContext,
} from "@/lib/types";

const MODEL = "googleai/gemini-2.5-flash";
// Keep bursts well under the Gemini rate limit (gentle off-peak generation).
const INSIGHT_CONCURRENCY = 2;
// Max NEW (not-yet-done) stores generated per cron fire. With several off-peak
// fires + per-store skip-if-done, the work spreads into small batches and no
// store is ever generated twice in a day.
const INSIGHT_BATCH = 4;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

/** The day the insight analyzes = yesterday (Asia/Manila), YYYYMMDD. */
export function getInsightDayId(now: Date = new Date()): string {
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

function buildMetricsAndDigest(
  yest: DM,
  prevDay: DM | null,
  sameDowAvgGross: number | null,
  avg7Gross: number | null,
  sameDowAvgCovers: number | null,
  dowName: string,
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
    if (voided > 0) anomalies.push({ label: "Voided", value: peso(voided), sub: `${count(yest?.items?.voidedQty ?? 0)} items`, direction: null });
    if (discounted > 0) anomalies.push({ label: "Discounts", value: peso(discounted), sub: `${count(yest?.items?.discountedQty ?? 0)} items`, direction: null });
    if (free > 0) anomalies.push({ label: "Free items", value: peso(free), sub: `${count(yest?.items?.freeQty ?? 0)} items`, direction: null });
    if (refundCount > 0) anomalies.push({ label: "Refunds", value: peso(refundTotal), sub: `${count(refundCount)} refund(s)`, direction: null });
    if (charges > 0) anomalies.push({ label: "Extra charges", value: peso(charges), sub: null, direction: null });
    if (noGuestHours > 0) anomalies.push({ label: "Idle hours (within open window)", value: count(noGuestHours), sub: "no sessions", direction: "down" });
  }

  // Digest text (what the model reads)
  const line = (m: InsightMetric) => `- ${m.label}: ${m.value}${m.sub ? ` (${m.sub})` : ""}`;
  const digest = [
    "SALES",
    ...sales.map(line),
    slowPkg && slowPkg.key !== topPkg?.key ? `- Lowest-selling package: ${slowPkg.key} (${peso(slowPkg.val)})` : "",
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

/* ----------------------------- weather + context ------------------------ */

function monthsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  let y = manilaParts(start).y, m = manilaParts(start).m;
  const ey = manilaParts(end).y, em = manilaParts(end).m;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

async function buildWeatherContext(storeId: string, now: Date): Promise<string | undefined> {
  const db = getAdminDb();
  const ids = monthsBetween(addDays(now, -2), addDays(now, 2));
  const snaps = await Promise.all(ids.map((ym) => db.doc(`stores/${storeId}/weatherForecasts/${ym}`).get()));
  const days: Record<string, any> = {};
  for (const s of snaps) {
    if (!s.exists) continue;
    const d = (s.data()?.days ?? {}) as Record<string, any>;
    for (const k of Object.keys(d)) days[k] = d[k];
  }
  const readable = (c: any) => (typeof c === "string" ? c.replace(/_/g, " ") : c);
  const fmt = (offset: number, label: string) => {
    const id = dayIdOf(addDays(now, offset));
    const w = days[id];
    if (!w) return null;
    return `${label}: ${readable(w.condition)}${w.pm ? ` (PM ${readable(w.pm)})` : ""}${typeof w.pop === "number" ? `, ${Math.round(w.pop * 100)}% rain` : ""}`;
  };
  const parts = [fmt(-1, "Yesterday"), fmt(0, "Today"), fmt(1, "Tomorrow")].filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

async function buildDayContext(storeId: string, yesterday: Date, today: Date): Promise<string | undefined> {
  const db = getAdminDb();
  const yId = dayIdOf(yesterday);
  const tId = dayIdOf(today);
  const [yS, tS] = await Promise.all([
    db.doc(`stores/${storeId}/dailyContext/${yId}`).get(),
    db.doc(`stores/${storeId}/dailyContext/${tId}`).get(),
  ]);
  const parts: string[] = [];
  const yd = yS.exists ? (yS.data() as DailyContext) : null;
  const td = tS.exists ? (tS.data() as DailyContext) : null;
  if (yd?.isPayday?.value) parts.push("Yesterday was a payday.");
  if (yd?.holiday && yd.holiday.name !== "None") parts.push(`Yesterday was ${yd.holiday.name}.`);
  if (td?.isPayday?.value) parts.push("Today is a payday.");
  if (td?.holiday && td.holiday.name !== "None") parts.push(`Today is ${td.holiday.name}.`);
  return parts.length ? parts.join(" ") : undefined;
}

/* ----------------------------- main entry ------------------------------- */

type StoreData = { id: string; name?: string; isActive?: boolean };

const emptySection = (headline: string, metrics: InsightMetric[]): InsightSectionData => ({
  headline, metrics, narrative: "", flags: [],
});

export async function generateDailyInsightForStore(
  store: StoreData,
  source: "manual" | "cron" = "manual",
  opts: { force?: boolean } = {},
): Promise<{ storeId: string; ok: boolean; status?: string; error?: string; skipped?: boolean }> {
  const db = getAdminDb();
  const now = new Date();
  const yesterday = addDays(now, -1);
  const dayId = dayIdOf(yesterday);
  const insightRef = db.doc(`stores/${store.id}/aiInsights/${dayId}`);

  // Cost guard: a store already analyzed today needs no second Gemini call.
  // (Manual "Regenerate" passes force=true to override.)
  if (!opts.force) {
    const existing = await insightRef.get();
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
      const doc: DailyInsight = {
        dayId, storeId: store.id, status: "no_data", source, model: MODEL,
        generatedAt: FieldValue.serverTimestamp(), generatedAtMs: Date.now(),
        summary: { headline: "No sales recorded yesterday.", bullets: [], sentiment: "mixed" },
        sales: emptySection("No data", []), operations: emptySection("No data", []),
        inventory: emptySection("No data", []), anomalies: emptySection("No data", []),
        suggestions: [], error: null,
      };
      await insightRef.set(doc);
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

    const { sections, digest } = buildMetricsAndDigest(yest, prevDay, sameDowAvgGross, avg7Gross, sameDowAvgCovers, DAY_NAMES[yDow]);

    const [weatherContext, dayContext] = await Promise.all([
      buildWeatherContext(store.id, now).catch(() => undefined),
      buildDayContext(store.id, yesterday, now).catch(() => undefined),
    ]);

    const p = manilaParts(yesterday);
    const dateLabel = `${DAY_NAMES[yDow]}, ${p.day} ${MONTH_NAMES[p.m - 1]} ${p.y}`;

    const ai = await runDailyInsightFlow({
      storeName: store.name || store.id,
      dateLabel,
      dayOfWeek: DAY_NAMES[yDow],
      metricsDigest: digest,
      weatherContext,
      dayContext,
    });

    const merge = (key: "sales" | "operations" | "inventory" | "anomalies"): InsightSectionData => ({
      headline: ai[key].headline,
      metrics: sections[key],
      narrative: ai[key].narrative,
      flags: ai[key].flags ?? [],
    });

    const doc: DailyInsight = {
      dayId, storeId: store.id, status: "ok", source, model: MODEL,
      generatedAt: FieldValue.serverTimestamp(), generatedAtMs: Date.now(),
      summary: ai.summary,
      sales: merge("sales"),
      operations: merge("operations"),
      inventory: merge("inventory"),
      anomalies: merge("anomalies"),
      suggestions: ai.suggestions ?? [],
      error: null,
    };
    await insightRef.set(doc);
    return { storeId: store.id, ok: true, status: "ok" };
  } catch (err: any) {
    console.error(`[generateDailyInsightForStore] store=${store.id} failed:`, err);
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

export async function generateInsightsForAllActiveStores(opts: { batchSize?: number } = {}) {
  const db = getAdminDb();
  const dayId = getInsightDayId();
  const storesSnap = await db.collection("stores").where("isActive", "==", true).get();
  const stores: StoreData[] = storesSnap.docs.map((d) => ({ id: d.id, name: d.data().name, isActive: d.data().isActive }));
  if (stores.length === 0) return { totalStores: 0, pending: 0, processed: 0, remaining: 0, results: [] as Awaited<ReturnType<typeof generateDailyInsightForStore>>[] };

  // Skip stores already done today (output doc ok/no_data) — no Gemini call.
  const doneSnaps = await db.getAll(...stores.map((s) => db.doc(`stores/${s.id}/aiInsights/${dayId}`)));
  const pending = stores.filter((_, i) => {
    const st = doneSnaps[i].exists ? (doneSnaps[i].data() as any)?.status : null;
    return !(st === "ok" || st === "no_data");
  });

  // Process only a batch of pending stores per fire (the rest wait for the next
  // off-peak fire), keeping each burst small.
  const slice = opts.batchSize ? pending.slice(0, opts.batchSize) : pending;
  const results = await mapWithConcurrency(slice, INSIGHT_CONCURRENCY, (s) => generateDailyInsightForStore(s, "cron"));
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
const CRON_LOG_DOC = "system/insightCronLog";
const MAX_DAILY_ATTEMPTS = 5;

export async function runInsightWithTracking(): Promise<{ skipped: boolean; reason: string; result?: Awaited<ReturnType<typeof generateInsightsForAllActiveStores>> }> {
  const db = getAdminDb();
  const dateStr = getManilaDateStr();
  const logDoc = await db.doc(CRON_LOG_DOC).get();
  const runs = (logDoc.exists ? logDoc.data()?.runs : {}) ?? {};
  const log = runs[dateStr] as { status: string; attempts: number } | undefined;
  if (log?.status === "success") return { skipped: true, reason: "Already succeeded today." };
  if ((log?.attempts ?? 0) >= MAX_DAILY_ATTEMPTS) return { skipped: true, reason: "Max attempts reached." };

  const attempts = (log?.attempts ?? 0) + 1;
  try {
    const result = await generateInsightsForAllActiveStores({ batchSize: INSIGHT_BATCH });
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
      reason: allDone ? "All insights generated." : `Processed ${result.processed}; ${result.remaining} store(s) remaining.`,
      result,
    };
  } catch (err) {
    await db.doc(CRON_LOG_DOC).set({ runs: { [dateStr]: { status: "failed", attempts, lastAttemptAt: Timestamp.now() } } }, { merge: true });
    throw err;
  }
}
