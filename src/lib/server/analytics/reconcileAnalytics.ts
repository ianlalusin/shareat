import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Receipt } from "@/lib/types";
import { applyAnalyticsDeltaServer } from "./applyAnalyticsDeltaServer";

// Durable backstop for receipt analytics: if the server-first endpoint call ever
// fails for a receipt (after client retries), the receipt is left with a pending
// flag — analyticsApplied:false (payment/refund not applied) or
// analyticsReversed:false (void not reversed). This sweep finds those via cheap
// single-field queries (≈0 docs on a healthy system) and applies them with the
// same idempotent server writer, so nothing is permanently dropped.

const PER_STORE_LIMIT = 500;

async function reconcileApplyPending(db: Firestore, storeId: string): Promise<number> {
  const snap = await db
    .collection(`stores/${storeId}/receipts`)
    .where("analyticsApplied", "==", false)
    .limit(PER_STORE_LIMIT)
    .get();

  let applied = 0;
  for (const d of snap.docs) {
    const ref = d.ref;
    const did = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return false;
      const r = { id: ref.id, ...(s.data() as any) } as Receipt;
      if ((r as any).analyticsApplied === true) return false; // applied meanwhile
      // null -> receipt (payment/refund shape). A voided-and-never-applied receipt
      // contributes zero, so this safely just flips the flag.
      applyAnalyticsDeltaServer(db, storeId, null, r, tx, new Date());
      tx.update(ref, {
        analyticsApplied: true,
        analyticsAppliedAt: FieldValue.serverTimestamp(),
        analyticsReconciledAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (did) applied++;
  }
  return applied;
}

async function reconcileReversePending(db: Firestore, storeId: string): Promise<number> {
  const snap = await db
    .collection(`stores/${storeId}/receipts`)
    .where("analyticsReversed", "==", false)
    .limit(PER_STORE_LIMIT)
    .get();

  let reversed = 0;
  for (const d of snap.docs) {
    const ref = d.ref;
    const did = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return false;
      const r = { id: ref.id, ...(s.data() as any) } as any;
      if (r.analyticsReversed === true) return false; // reversed meanwhile
      if (r.analyticsApplied !== true) {
        // nothing was ever applied -> nothing to reverse; mark consistent
        tx.update(ref, { analyticsReversed: true, analyticsReversedAt: FieldValue.serverTimestamp() });
        return false;
      }
      const asOriginal = {
        ...r,
        isVoided: false,
        status: r.status === "voided" ? "final" : r.status,
      } as Receipt;
      applyAnalyticsDeltaServer(db, storeId, asOriginal, null, tx, new Date());
      tx.update(ref, {
        analyticsReversed: true,
        analyticsReversedAt: FieldValue.serverTimestamp(),
        analyticsReconciledAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (did) reversed++;
  }
  return reversed;
}

export async function reconcileAnalyticsForStore(db: Firestore, storeId: string) {
  const applied = await reconcileApplyPending(db, storeId);
  const reversed = await reconcileReversePending(db, storeId);
  return { storeId, applied, reversed };
}

export async function reconcileAnalyticsForAllStores(
  db: Firestore,
): Promise<{ totalStores: number; applied: number; reversed: number; results: Array<{ storeId: string; applied: number; reversed: number }> }> {
  const stores = await db.collection("stores").where("isActive", "==", true).get();
  const results: Array<{ storeId: string; applied: number; reversed: number }> = [];
  for (const s of stores.docs) {
    results.push(await reconcileAnalyticsForStore(db, s.id));
  }
  return {
    totalStores: stores.size,
    applied: results.reduce((n, r) => n + r.applied, 0),
    reversed: results.reduce((n, r) => n + r.reversed, 0),
    results,
  };
}
