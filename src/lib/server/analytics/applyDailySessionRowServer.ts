import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Receipt, Store } from "@/lib/types";
import { buildSessionRow } from "@/lib/analytics/session-row";
import { getDayIdFromTimestamp, getDayStartMs } from "@/lib/analytics/daily";
import { toJsDate } from "@/lib/utils/date";

/**
 * Per-session rows for the Daily Session Timeline, at
 * stores/{storeId}/dailySessions/{YYYYMMDD}.
 *
 * One document per store per Manila day, holding a map of rows keyed by receipt
 * id. A map rather than an array so a single session upserts with
 * set(merge: true) and no read-modify-write — that keeps the write safe to fold
 * into the analytics-delta transaction, which has already read the receipt and
 * must not read again after writing.
 *
 * Sizing: the busiest store peaks around 50 receipts/day (~12 KB of rows), three
 * orders of magnitude under the 1 MiB document limit.
 */

// Minimal structural writer satisfied by both an admin Transaction and a
// WriteBatch, matching applyAnalyticsDeltaServer's AnalyticsWriter.
interface DailySessionWriter {
  set(ref: any, data: any, options: any): unknown;
}

export function dailySessionsDocRef(db: Firestore, storeId: string, dayId: string) {
  return db.doc(`stores/${storeId}/dailySessions/${dayId}`);
}

/** The Manila day a receipt belongs to, from its close time. */
function receiptDayId(receipt: Receipt): string | null {
  const closedAtMs = (receipt as any).createdAtClientMs || toJsDate((receipt as any).createdAt)?.getTime() || null;
  if (!closedAtMs) return null;
  return getDayIdFromTimestamp(closedAtMs);
}

/**
 * Upserts the timeline row for a receipt. No-op when the receipt does not belong
 * on the timeline (voided, or no usable close time) — callers use
 * removeDailySessionRow for the void case, which needs the row gone rather than
 * merely skipped.
 */
export function upsertDailySessionRow(
  db: Firestore,
  storeId: string,
  receipt: Receipt | null,
  store: Store | null,
  writer: DailySessionWriter
): { dayId: string | null } {
  const built = buildSessionRow(receipt, store);
  if (!built) return { dayId: null };

  writer.set(
    dailySessionsDocRef(db, storeId, built.dayId),
    {
      meta: {
        storeId,
        dayId: built.dayId,
        dayStartMs: getDayStartMs(built.row.closedAtMs),
        updatedAt: FieldValue.serverTimestamp(),
      },
      rows: { [built.rowKey]: built.row },
    },
    { merge: true }
  );

  return { dayId: built.dayId };
}

/**
 * Drops a receipt's row from its day doc. Used when a receipt is voided: the
 * timeline shows closed/paid sessions only, so a void removes the row rather
 * than flagging it.
 *
 * Keyed off the receipt's own close time, which a void does not change, so the
 * delete always lands on the same document the upsert wrote.
 */
export function removeDailySessionRow(
  db: Firestore,
  storeId: string,
  receipt: Receipt | null,
  writer: DailySessionWriter
): { dayId: string | null } {
  if (!receipt) return { dayId: null };
  const dayId = receiptDayId(receipt);
  if (!dayId) return { dayId: null };

  writer.set(
    dailySessionsDocRef(db, storeId, dayId),
    {
      meta: { storeId, dayId, updatedAt: FieldValue.serverTimestamp() },
      rows: { [receipt.id]: FieldValue.delete() },
    },
    { merge: true }
  );

  return { dayId };
}
