import "server-only";

import { Timestamp, FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Receipt, KitchenTicket, Store } from "@/lib/types";
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

  const [receiptsSnap, ticketsSnap, sessionsSnap] = await Promise.all([
    db.collection(`stores/${storeId}/receipts`)
      .where("createdAt", ">=", Timestamp.fromDate(startInclusive))
      .where("createdAt", "<", Timestamp.fromDate(endExclusive))
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
  const tickets = ticketsSnap.docs.map((d) => d.data() as KitchenTicket);
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
  const batch = db.batch();
  for (const { presetId, start, end } of ranges) {
    const snap = await db.collection(`stores/${storeId}/analytics`)
      .where("meta.dayStartMs", ">=", start.getTime())
      .where("meta.dayStartMs", "<=", end.getTime())
      .get();

    const agg: any = {};
    snap.forEach((d) => sumDailyBodyInto(agg, d.data()));

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
