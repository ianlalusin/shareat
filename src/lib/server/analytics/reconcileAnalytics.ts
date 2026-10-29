import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { applyReceiptEvent, type ReceiptEventOp } from "./receiptEventApplier";
import { getActiveStores } from "@/lib/server/active-stores-cache";

// Durable backstop for receipt analytics: if the server-first endpoint call ever
// fails for a receipt (after client retries), the receipt is left with a pending
// flag — analyticsApplied:false (payment/refund not applied) or
// analyticsReversed:false (void not reversed). This sweep finds those via cheap
// single-field queries (≈0 docs on a healthy system) and runs the SAME shared
// transactional applier as /api/analytics/apply-delta (B23), so a cron win
// leaves exactly the state an endpoint win would (rollups, retained void cash,
// timeline row, popularity) and a later endpoint retry is a clean no-op.

const PER_STORE_LIMIT = 500;

async function sweep(
  db: Firestore,
  storeId: string,
  field: "analyticsApplied" | "analyticsReversed",
  op: ReceiptEventOp,
): Promise<{ done: number; failed: number }> {
  const snap = await db
    .collection(`stores/${storeId}/receipts`)
    .where(field, "==", false)
    .limit(PER_STORE_LIMIT)
    .get();

  let done = 0;
  let failed = 0;
  for (const d of snap.docs) {
    try {
      const res = await applyReceiptEvent(db, storeId, d.id, op, { source: "reconcile" });
      if (!res.skipped) done++;
    } catch (err: any) {
      // One bad receipt (e.g. analyticsReversed:false on a non-voided receipt)
      // must not block the rest of the sweep. It stays pending and is logged.
      failed++;
      console.error(`[reconcile-analytics] ${storeId}/${d.id} op=${op}: ${err?.message || err}`);
    }
  }
  return { done, failed };
}

export async function reconcileAnalyticsForStore(db: Firestore, storeId: string) {
  const a = await sweep(db, storeId, "analyticsApplied", "payment");
  const r = await sweep(db, storeId, "analyticsReversed", "void");
  return { storeId, applied: a.done, reversed: r.done, failed: a.failed + r.failed };
}

export async function reconcileAnalyticsForAllStores(
  db: Firestore,
): Promise<{ totalStores: number; applied: number; reversed: number; failed: number; results: Array<{ storeId: string; applied: number; reversed: number; failed: number }> }> {
  const stores = await getActiveStores(db);
  const results: Array<{ storeId: string; applied: number; reversed: number; failed: number }> = [];
  for (const s of stores) {
    results.push(await reconcileAnalyticsForStore(db, s.id));
  }
  return {
    totalStores: stores.length,
    applied: results.reduce((n, r) => n + r.applied, 0),
    reversed: results.reduce((n, r) => n + r.reversed, 0),
    failed: results.reduce((n, r) => n + r.failed, 0),
    results,
  };
}
