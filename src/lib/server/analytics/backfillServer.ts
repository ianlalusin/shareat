import "server-only";

import { Timestamp, FieldValue, FieldPath, type Firestore } from "firebase-admin/firestore";
import type { Receipt, KitchenTicket, Store } from "@/lib/types";
import { buildSessionRow, type DailySessionRow } from "@/lib/analytics/session-row";
import { getDayIdFromTimestamp, getDayStartMs } from "@/lib/analytics/daily";
import {
  aggregateDailyMetrics,
  sumDailyBodyInto,
  topRefillsFrom,
  topAddonsFrom,
  presetRanges,
} from "@/lib/analytics/backfill-core";
import { getActiveStores } from "@/lib/server/active-stores-cache";
import { safeKey } from "@/lib/analytics/delta-core";
import { asOriginalReceipt, isVoidedReceipt, retainedCashDay } from "./receiptEventApplier";

// Admin-SDK backfill, the server home of the admin maintenance rebuilds. Reads
// receipts/tickets/sessions, aggregates via the shared core, and overwrites the
// analytics / analyticsMonths / analyticsYears / dashPresets docs server-side so
// those collections can be locked to server writes only.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rescan attempts before a rebuild gives up on a store/day range that never goes quiet. */
export const MAX_REBUILD_ATTEMPTS = 5;
/** Day docs per commit transaction (each costs one read + one write). */
const REBUILD_TX_CHUNK = 200;

/** Every Manila day whose start falls in [startInclusiveMs, endExclusiveMs). */
export function requestedDays(startInclusiveMs: number, endExclusiveMs: number): Array<{ dayId: string; dayStartMs: number }> {
  const out: Array<{ dayId: string; dayStartMs: number }> = [];
  let ms = getDayStartMs(startInclusiveMs);
  if (ms < startInclusiveMs) ms += DAY_MS;
  // Manila has no DST, so whole-day steps stay on day boundaries.
  for (; ms < endExclusiveMs; ms += DAY_MS) out.push({ dayId: getDayIdFromTimestamp(ms), dayStartMs: ms });
  return out;
}

/**
 * Receipts as the LIVE projection currently counts them, so a rebuilt doc and
 * the live appliers agree on who owns which receipt:
 *  - pending apply (analyticsApplied:false, not voided) is left OUT — the
 *    endpoint/reconcile cron will add it on top of the rebuilt doc later;
 *  - voided with its reversal still pending (applied, analyticsReversed:false)
 *    is counted as its ORIGINAL sale — the pending reversal will subtract it;
 *  - an edit whose analytics delta is still pending is counted as the receipt
 *    stood BEFORE that edit (`pendingEditBefore`, the revision snapshot) — the
 *    pending edit delta (snapshot -> current receipt) will move it once. The
 *    edit save commits the new receipt body before the delta runs, so counting
 *    the current body here would be moved a second time by that delta.
 */
function receiptsAsProjected(receipts: Receipt[], pendingEditBefore: Map<string, Receipt> = new Map()): Receipt[] {
  const out: Receipt[] = [];
  for (const current of receipts) {
    const before = pendingEditBefore.get(String((current as any).id));
    // Body of the last applied state; the status/flags that gate the other
    // pending events still come from the receipt as it is now.
    const r = before
      ? ({
          ...before,
          id: (current as any).id,
          status: (current as any).status,
          isVoided: (current as any).isVoided,
          analyticsApplied: (current as any).analyticsApplied,
          analyticsReversed: (current as any).analyticsReversed,
        } as Receipt)
      : current;
    const x = r as any;
    const voided = isVoidedReceipt(x);
    if (!voided && x.analyticsApplied === false) continue;
    if (voided && x.analyticsApplied === true && x.analyticsReversed === false) {
      out.push(asOriginalReceipt(r));
      continue;
    }
    out.push(r);
  }
  return out;
}

/**
 * The edit version whose analytics delta has not been applied yet, or null.
 * The receipts screen bumps `editVersion` when it saves an edit and the applier
 * sets `analyticsEditVersion` once that edit's delta has landed.
 */
export function pendingEditVersion(r: any): number | null {
  const edited = Number(r?.editVersion || 0);
  const applied = Number(r?.analyticsEditVersion || 0);
  return edited > applied ? applied + 1 : null;
}

/**
 * For each receipt with a pending edit delta, the receipt as it stood before the
 * earliest pending edit (that revision's snapshot) = the last state analytics
 * counted. A missing revision falls back to the current body (and is logged).
 */
async function loadPendingEditBefore(db: Firestore, storeId: string, receipts: Receipt[]): Promise<Map<string, Receipt>> {
  const out = new Map<string, Receipt>();
  for (const r of receipts) {
    const version = pendingEditVersion(r);
    if (version === null) continue;
    const id = String((r as any).id);
    const snap = await db.collection(`stores/${storeId}/receipts/${id}/revisions`).get();
    const rev = snap.docs.map((d) => d.data() as any).find((d) => Number(d?.version || 0) === version);
    if (!rev?.snapshot) {
      console.warn(`[analytics rebuild] receipt ${id} has edit v${version} pending but no revision snapshot; counting its current body`);
      continue;
    }
    out.set(id, rev.snapshot as Receipt);
  }
  return out;
}

/** payments.voidCashRetainedTotal per day, as the live void/re-ring ops accrue it. */
function retainedCashByDay(receipts: Receipt[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of receipts) {
    const x = r as any;
    if (!isVoidedReceipt(x)) continue;
    const retained = Number(x.voidCashRetained || 0);
    if (!(retained > 0)) continue;
    const net = (x.analyticsReversed === true ? retained : 0) - (x.voidCashRetainedReversed === true ? retained : 0);
    if (!net) continue;
    const day = retainedCashDay(r);
    if (day) out.set(day.dayId, (out.get(day.dayId) ?? 0) + net);
  }
  return out;
}

/**
 * Rebuild daily analytics docs for [startDate, endDate] from receipts/tickets/
 * sessions, without losing live deltas (B26).
 *
 * Concurrency design — optimistic, keyed on the day docs themselves:
 *  Every live writer of a day doc (receipt applier, reconcile cron, KDS, chat,
 *  payment conversions, online orders) writes that doc in its own transaction,
 *  which bumps the doc's server updateTime. So:
 *   1. Watermark: read every requested day doc and remember its updateTime.
 *   2. Scan the source collections and aggregate in memory.
 *   3. Commit in a transaction that re-reads the day docs and writes the
 *      rebuilt docs ONLY if every updateTime still equals the watermark.
 *  If any live write landed between 1 and 3, its event may be missing from (or
 *  double-counted against) the scan, so that chunk is NOT written: the rebuild
 *  rescans and tries again (bounded by MAX_REBUILD_ATTEMPTS). A live write
 *  after step 3's read is serialized by Firestore behind the commit and
 *  increments the rebuilt doc — and its receipt was excluded from the scan
 *  because it was still pending (see receiptsAsProjected), so nothing is lost or
 *  doubled. No lease doc and no change to any live writer is needed.
 *
 * Every requested day is written: a day with no source data is deleted, or
 * reduced to the fields the rebuild does not derive (chat.*, staffNames).
 * Active payment conversions and retained void cash are re-derived from their
 * source docs; chat response stats are carried over from the existing doc.
 */
export async function rebuildDailyAnalyticsFromReceiptsServer(
  db: Firestore,
  storeId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ days: number; receipts: number; tickets: number; deleted: number; attempts: number }> {
  const startInclusive = new Date(startDate);
  const endExclusive = new Date(endDate);
  endExclusive.setDate(endExclusive.getDate() + 1);

  const storeSnap = await db.doc(`stores/${storeId}`).get();
  if (!storeSnap.exists) throw new Error("Store not found.");
  const store = storeSnap.data() as Store;

  const days = requestedDays(startInclusive.getTime(), endExclusive.getTime());
  const dayStartById = new Map(days.map((d) => [d.dayId, d.dayStartMs]));
  const remaining = new Set(days.map((d) => d.dayId));
  const dayRef = (dayId: string) => db.doc(`stores/${storeId}/analytics/${dayId}`);

  // Receipts and tickets are read a day wider than the window: peak-hour and
  // day-of-week bucket by ARRIVAL, so a party can arrive on one side of the
  // window edge and pay on the other. aggregateDailyMetrics drops what falls outside.
  const wideStart = Timestamp.fromDate(new Date(startInclusive.getTime() - DAY_MS));
  const wideEnd = Timestamp.fromDate(new Date(endExclusive.getTime() + DAY_MS));
  const firstDayId = days[0]?.dayId ?? "";
  const lastDayId = days[days.length - 1]?.dayId ?? "";

  let written = 0;
  let deleted = 0;
  let receiptCount = 0;
  let ticketCount = 0;

  for (let attempt = 1; attempt <= MAX_REBUILD_ATTEMPTS && remaining.size; attempt++) {
    const ids = [...remaining];

    // 1. Watermark.
    const pre = await db.getAll(...ids.map(dayRef));
    const watermark = new Map<string, Timestamp | null>();
    for (const s of pre) watermark.set(s.id, s.exists ? (s.updateTime ?? null) : null);

    // 2. Scan + aggregate.
    const [receiptsSnap, ticketsSnap, sessionsSnap, conversionsSnap] = await Promise.all([
      db.collection(`stores/${storeId}/receipts`)
        .where("createdAt", ">=", wideStart)
        .where("createdAt", "<", wideEnd)
        .orderBy("createdAt", "asc")
        .get(),
      db.collectionGroup("kitchentickets")
        .where("storeId", "==", storeId)
        .where("createdAt", ">=", wideStart)
        .where("createdAt", "<", wideEnd)
        .get(),
      db.collection(`stores/${storeId}/sessions`)
        .where("verifiedAt", ">=", Timestamp.fromDate(startInclusive))
        .where("verifiedAt", "<", Timestamp.fromDate(endExclusive))
        .get(),
      db.collection(`stores/${storeId}/paymentConversions`)
        .where("dayId", ">=", firstDayId)
        .where("dayId", "<=", lastDayId)
        .get(),
    ]);

    const receipts = receiptsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Receipt));
    const tickets = ticketsSnap.docs.map((d) => d.data() as KitchenTicket).filter((t) => !(t as any).onlineOrderId);
    const verifiedSessions = sessionsSnap.docs.map((d) => d.data() as any);
    receiptCount = receipts.length;
    ticketCount = tickets.length;

    const pendingEditBefore = await loadPendingEditBefore(db, storeId, receipts);
    const aggregates = aggregateDailyMetrics({
      receipts: receiptsAsProjected(receipts, pendingEditBefore),
      tickets,
      verifiedSessions,
      store,
      storeId,
      startInclusiveMs: startInclusive.getTime(),
      endExclusiveMs: endExclusive.getTime(),
    });
    const retained = retainedCashByDay(receipts);
    // Payment conversions (cash -> GCash etc.) shift byMethod on their day; the
    // receipts alone don't know about them, so re-apply the active ones.
    const conversions = new Map<string, Array<{ from: string; to: string; amount: number }>>();
    for (const d of conversionsSnap.docs) {
      const c = d.data() as any;
      if (c?.status !== "active") continue;
      const amount = Number(c.amount);
      const from = safeKey(String(c.fromMethod || ""));
      const to = safeKey(String(c.toMethod || ""));
      if (!(amount > 0) || !from || !to || from === to) continue;
      const list = conversions.get(String(c.dayId)) ?? [];
      list.push({ from, to, amount });
      conversions.set(String(c.dayId), list);
    }

    // 3. Commit chunk by chunk, each guarded by the watermark.
    let dirty = false;
    for (let i = 0; i < ids.length && !dirty; i += REBUILD_TX_CHUNK) {
      const chunk = ids.slice(i, i + REBUILD_TX_CHUNK);
      const res = await db.runTransaction(async (tx) => {
        const snaps = await tx.getAll(...chunk.map(dayRef));
        for (const s of snaps) {
          const cur = s.exists ? (s.updateTime ?? null) : null;
          const was = watermark.get(s.id) ?? null;
          const same = cur === null || was === null ? cur === was : cur.isEqual(was);
          if (!same) return null; // a live write landed after the watermark
        }
        let w = 0;
        let del = 0;
        for (const s of snaps) {
          const dayId = s.id;
          const existing = s.exists ? (s.data() as any) : null;
          let data: any = aggregates.get(dayId) ?? null;
          const ret = retained.get(dayId) ?? 0;
          const conv = conversions.get(dayId) ?? [];
          const chat = existing?.chat;
          if (!data && !ret && !conv.length && chat === undefined) {
            // No source data for this day: stale doc goes away entirely.
            if (s.exists) {
              tx.delete(s.ref);
              del++;
            }
            continue;
          }
          data ??= { meta: { dayId, dayStartMs: dayStartById.get(dayId), storeId } };
          if (ret || conv.length) {
            data.payments ??= {};
            data.payments.byMethod ??= {};
            if (ret) data.payments.voidCashRetainedTotal = ret;
            for (const c of conv) {
              data.payments.byMethod[c.from] = (data.payments.byMethod[c.from] || 0) - c.amount;
              data.payments.byMethod[c.to] = (data.payments.byMethod[c.to] || 0) + c.amount;
            }
          }
          // Not derivable from source docs; keep what the live chat applier wrote.
          if (chat !== undefined) data.chat = chat;
          if (existing?.staffNames) data.staffNames = { ...existing.staffNames, ...(data.staffNames ?? {}) };
          data.meta.updatedAt = FieldValue.serverTimestamp();
          data.meta.backfilledAt = FieldValue.serverTimestamp();
          data.meta.source = "backfill_v6_server";
          tx.set(s.ref, data, { merge: false });
          w++;
        }
        return { w, del };
      });
      if (!res) {
        dirty = true;
        break;
      }
      written += res.w;
      deleted += res.del;
      for (const id of chunk) remaining.delete(id);
    }
    if (!dirty) {
      return { days: written, receipts: receiptCount, tickets: ticketCount, deleted, attempts: attempt };
    }
  }
  if (!remaining.size) {
    return { days: written, receipts: receiptCount, tickets: ticketCount, deleted, attempts: MAX_REBUILD_ATTEMPTS };
  }
  throw new Error(
    `Analytics rebuild kept colliding with live writes for ${remaining.size} day(s); those days were not overwritten. Try again.`,
  );
}

/**
 * Rebuild the Daily Session Timeline day docs for [startDate, endDate] from receipts.
 *
 * The receipt window is deliberately widened by a day on each side and the
 * resulting rows are then filtered by their Manila dayId. Querying `createdAt`
 * gives a UTC window, but rows are bucketed by Manila day, so without the widening
 * a receipt rung at 00:30 PHT would land in a day doc the caller never asked to
 * rebuild — writing it partially and leaving it inconsistent.
 *
 * Day docs are overwritten (merge: false) so a rebuild is authoritative. Docs in
 * range that end up with no rows (e.g. every receipt was voided) are deleted
 * rather than left stale.
 */
export async function rebuildDailySessionsFromReceiptsServer(
  db: Firestore,
  storeId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ days: number; rows: number; receipts: number; deleted: number }> {
  const startDayId = getDayIdFromTimestamp(startDate);
  const endDayId = getDayIdFromTimestamp(endDate);

  const storeSnap = await db.doc(`stores/${storeId}`).get();
  if (!storeSnap.exists) throw new Error("Store not found.");
  const store = { id: storeId, ...(storeSnap.data() as any) } as Store;

  const queryStart = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
  const queryEnd = new Date(endDate.getTime() + 2 * 24 * 60 * 60 * 1000);

  const receiptsSnap = await db
    .collection(`stores/${storeId}/receipts`)
    .where("createdAt", ">=", Timestamp.fromDate(queryStart))
    .where("createdAt", "<", Timestamp.fromDate(queryEnd))
    .orderBy("createdAt", "asc")
    .get();

  const byDay = new Map<string, Record<string, DailySessionRow>>();
  let rows = 0;
  for (const d of receiptsSnap.docs) {
    const receipt = { id: d.id, ...(d.data() as any) } as Receipt;
    const built = buildSessionRow(receipt, store);
    if (!built) continue; // voided, or no usable close time
    if (built.dayId < startDayId || built.dayId > endDayId) continue;
    if (!byDay.has(built.dayId)) byDay.set(built.dayId, {});
    byDay.get(built.dayId)![built.rowKey] = built.row;
    rows++;
  }

  // Day docs already in range that this rebuild produced no rows for are stale.
  // dayIds are YYYYMMDD, so lexicographic document-id order is chronological.
  const existingSnap = await db
    .collection(`stores/${storeId}/dailySessions`)
    .orderBy(FieldPath.documentId())
    .startAt(startDayId)
    .endAt(endDayId)
    .get();
  const stale = existingSnap.docs.map((d) => d.id).filter((id) => !byDay.has(id));

  let batch = db.batch();
  let opCount = 0;
  const commits: Promise<unknown>[] = [];
  const flush = () => {
    if (++opCount >= 450) {
      commits.push(batch.commit());
      batch = db.batch();
      opCount = 0;
    }
  };

  for (const [dayId, rowMap] of byDay.entries()) {
    const anyRow = Object.values(rowMap)[0];
    batch.set(
      db.doc(`stores/${storeId}/dailySessions/${dayId}`),
      {
        meta: {
          storeId,
          dayId,
          dayStartMs: anyRow ? getDayStartMs(anyRow.closedAtMs) : 0,
          updatedAt: FieldValue.serverTimestamp(),
          rebuiltAt: FieldValue.serverTimestamp(),
          source: "backfill_sessions_v1",
        },
        rows: rowMap,
      },
      { merge: false },
    );
    flush();
  }
  for (const dayId of stale) {
    batch.delete(db.doc(`stores/${storeId}/dailySessions/${dayId}`));
    flush();
  }
  if (opCount > 0) commits.push(batch.commit());
  await Promise.all(commits);

  return { days: byDay.size, rows, receipts: receiptsSnap.size, deleted: stale.length };
}

/** Recompute dine-in session-duration fields on month/year rollups from daily docs. */
export async function backfillSessionDurationRollupsServer(
  db: Firestore,
  storeId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ months: number; years: number }> {
  const monthIds = new Set<string>();
  const yearIds = new Set<string>();
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const stop = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cursor.getTime() <= stop.getTime()) {
    monthIds.add(`${cursor.getFullYear()}${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    yearIds.add(String(cursor.getFullYear()));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const sumDailyDurations = async (startMs: number, endMs: number) => {
    const snap = await db.collection(`stores/${storeId}/analytics`)
      .where("meta.dayStartMs", ">=", startMs)
      .where("meta.dayStartMs", "<", endMs)
      .get();
    let msSum = 0;
    let count = 0;
    snap.forEach((d) => {
      const x: any = d.data();
      msSum += Number(x?.sessions?.dineInDurationMsSum ?? 0);
      count += Number(x?.sessions?.dineInDurationCount ?? 0);
    });
    return { msSum, count };
  };

  let batch = db.batch();
  for (const monthId of monthIds) {
    const y = parseInt(monthId.slice(0, 4), 10);
    const m = parseInt(monthId.slice(4, 6), 10) - 1;
    const { msSum, count } = await sumDailyDurations(new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime());
    batch.set(
      db.doc(`stores/${storeId}/analyticsMonths/${monthId}`),
      { meta: { storeId, monthId, updatedAt: FieldValue.serverTimestamp() }, sessions: { dineInDurationMsSum: msSum, dineInDurationCount: count } },
      { merge: true },
    );
  }
  for (const yearId of yearIds) {
    const y = parseInt(yearId, 10);
    const { msSum, count } = await sumDailyDurations(new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime());
    batch.set(
      db.doc(`stores/${storeId}/analyticsYears/${yearId}`),
      { meta: { storeId, yearId, updatedAt: FieldValue.serverTimestamp() }, sessions: { dineInDurationMsSum: msSum, dineInDurationCount: count } },
      { merge: true },
    );
  }
  await batch.commit();
  return { months: monthIds.size, years: yearIds.size };
}

/** Rebuild the dashboard preset rollup docs from daily analytics docs. */
export async function rebuildDashboardPresetsServer(
  db: Firestore,
  storeId: string,
  now: Date = new Date(),
): Promise<{ presets: number }> {
  const ranges = presetRanges(now);

  // Read the daily docs ONCE over the union of every preset window, then compute
  // each tile in memory. The windows overlap heavily (last7 ⊂ last30, etc.), so a
  // per-preset query re-reads the same docs up to 6–8×. Using the true min-start
  // (not just Jan 1) keeps lastMonth/last30/thisWeek correct across the year
  // boundary, where they reach into the prior year.
  const minStartMs = Math.min(...ranges.map((r) => r.start.getTime()));
  const maxEndMs = Math.max(...ranges.map((r) => r.end.getTime()));
  const unionSnap = await db.collection(`stores/${storeId}/analytics`)
    .where("meta.dayStartMs", ">=", minStartMs)
    .where("meta.dayStartMs", "<=", maxEndMs)
    .get();
  const days = unionSnap.docs.map((d) => d.data() as any);

  const batch = db.batch();
  for (const { presetId, start, end } of ranges) {
    const startMs = start.getTime();
    const endMs = end.getTime();

    const agg: any = {};
    for (const day of days) {
      const ms = Number(day?.meta?.dayStartMs);
      if (Number.isFinite(ms) && ms >= startMs && ms <= endMs) sumDailyBodyInto(agg, day);
    }

    const presetData = {
      ...agg,
      refills: { ...(agg.refills ?? {}), topRefillsByQty: topRefillsFrom(agg) },
      sales: { ...(agg.sales ?? {}), topAddonsByQty: topAddonsFrom(agg) },
      meta: {
        presetId,
        storeId,
        source: "backfill-server-presets",
        updatedAt: FieldValue.serverTimestamp(),
        rangeStartMs: start.getTime(),
        rangeEndMs: end.getTime(),
      },
    };
    batch.set(db.doc(`stores/${storeId}/dashPresets/${presetId}`), presetData);
  }
  await batch.commit();
  return { presets: ranges.length };
}

/**
 * Rebuild dashboard preset rollups for every active store.
 *
 * The live delta path only ever *adds* to the rolling-window preset docs
 * (today/yesterday/last7/last30/thisMonth/...) for whichever windows include an
 * event at the time it happens — it never subtracts a day once it rolls out of
 * the window. So those tiles inflate over time (observed: a "This Month" reading
 * 3×–11× the true receipt total). Re-summing from the per-day analytics docs
 * (which are always correct, being keyed by dayId) is the authoritative reset.
 * Scheduled daily so the tiles self-heal each morning; deltas keep them live
 * during the day.
 */
export async function rebuildDashboardPresetsForAllStores(
  db: Firestore,
  now: Date = new Date(),
): Promise<{ totalStores: number; presets: number; results: Array<{ storeId: string; presets: number }> }> {
  const stores = await getActiveStores(db);
  const results: Array<{ storeId: string; presets: number }> = [];
  for (const s of stores) {
    const r = await rebuildDashboardPresetsServer(db, s.id, now);
    results.push({ storeId: s.id, presets: r.presets });
  }
  return { totalStores: stores.length, presets: results.reduce((n, r) => n + r.presets, 0), results };
}
