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

// Admin-SDK backfill, the server home of the admin maintenance rebuilds. Reads
// receipts/tickets/sessions, aggregates via the shared core, and overwrites the
// analytics / analyticsMonths / analyticsYears / dashPresets docs server-side so
// those collections can be locked to server writes only.

/** Rebuild daily analytics docs for [startDate, endDate] from receipts/tickets/sessions. */
export async function rebuildDailyAnalyticsFromReceiptsServer(
  db: Firestore,
  storeId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ days: number; receipts: number; tickets: number }> {
  const startInclusive = new Date(startDate);
  const endExclusive = new Date(endDate);
  endExclusive.setDate(endExclusive.getDate() + 1);

  const storeSnap = await db.doc(`stores/${storeId}`).get();
  if (!storeSnap.exists) throw new Error("Store not found.");
  const store = storeSnap.data() as Store;

  const ticketsStart = new Date(startInclusive.getTime() - 24 * 60 * 60 * 1000);
  const ticketsEnd = new Date(endExclusive.getTime() + 24 * 60 * 60 * 1000);

  // Receipts are read a day wider than the rebuild window, like tickets: peak-hour and
  // day-of-week bucket by ARRIVAL, so a party that arrived 11:30 PM on the last day in
  // range pays after the window closes, and one that arrived before the window can pay
  // inside it. aggregateDailyMetrics drops whatever falls outside the window.
  const receiptsStart = new Date(startInclusive.getTime() - 24 * 60 * 60 * 1000);
  const receiptsEnd = new Date(endExclusive.getTime() + 24 * 60 * 60 * 1000);

  const [receiptsSnap, ticketsSnap, sessionsSnap] = await Promise.all([
    db.collection(`stores/${storeId}/receipts`)
      .where("createdAt", ">=", Timestamp.fromDate(receiptsStart))
      .where("createdAt", "<", Timestamp.fromDate(receiptsEnd))
      .orderBy("createdAt", "asc")
      .get(),
    db.collectionGroup("kitchentickets")
      .where("storeId", "==", storeId)
      .where("createdAt", ">=", Timestamp.fromDate(ticketsStart))
      .where("createdAt", "<", Timestamp.fromDate(ticketsEnd))
      .get(),
    db.collection(`stores/${storeId}/sessions`)
      .where("verifiedAt", ">=", Timestamp.fromDate(startInclusive))
      .where("verifiedAt", "<", Timestamp.fromDate(endExclusive))
      .get(),
  ]);

  const receipts = receiptsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Receipt));
  const tickets = ticketsSnap.docs.map((d) => d.data() as KitchenTicket).filter((t) => !(t as any).onlineOrderId);
  const verifiedSessions = sessionsSnap.docs.map((d) => d.data() as any);

  const aggregates = aggregateDailyMetrics({
    receipts,
    tickets,
    verifiedSessions,
    store,
    storeId,
    startInclusiveMs: startInclusive.getTime(),
    endExclusiveMs: endExclusive.getTime(),
  });

  let batch = db.batch();
  let opCount = 0;
  const commits: Promise<unknown>[] = [];
  for (const [dayId, data] of aggregates.entries()) {
    (data.meta as any).updatedAt = FieldValue.serverTimestamp();
    (data.meta as any).backfilledAt = FieldValue.serverTimestamp();
    (data.meta as any).source = "backfill_v5_server";
    batch.set(db.doc(`stores/${storeId}/analytics/${dayId}`), data as any, { merge: false });
    if (++opCount >= 450) {
      commits.push(batch.commit());
      batch = db.batch();
      opCount = 0;
    }
  }
  if (opCount > 0) commits.push(batch.commit());
  await Promise.all(commits);

  return { days: aggregates.size, receipts: receipts.length, tickets: tickets.length };
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
  const stores = await db.collection("stores").where("isActive", "==", true).get();
  const results: Array<{ storeId: string; presets: number }> = [];
  for (const s of stores.docs) {
    const r = await rebuildDashboardPresetsServer(db, s.id, now);
    results.push({ storeId: s.id, presets: r.presets });
  }
  return { totalStores: stores.size, presets: results.reduce((n, r) => n + r.presets, 0), results };
}
