import "server-only";

import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { applyAnalyticsDeltaServer } from "@/lib/server/analytics/applyAnalyticsDeltaServer";
import {
  removeDailySessionRow,
  upsertDailySessionRow,
} from "@/lib/server/analytics/applyDailySessionRowServer";
import { getPaymentContribution } from "@/lib/analytics/daily";
import {
  mergePopularityDeltas,
  popularityDeltaFromReceipt,
} from "@/lib/analytics/popular-items";
import type { Receipt, Store } from "@/lib/types";

/**
 * THE one transactional applier for receipt analytics events (B23).
 *
 * Every path that projects a receipt into analytics — the server-first
 * /api/analytics/apply-delta route and the reconcile cron backstop — runs the
 * same function, so all effects of an event land together in one transaction
 * and are gated by the same receipt flag:
 *
 *  payment/refund (null -> receipt), gate `analyticsApplied`:
 *    day/month/year/preset rollups + popularity +1 + timeline row.
 *  void (receipt -> null), gate `analyticsReversed`:
 *    rollup reversal + retained void cash (day doc, payment day only)
 *    + popularity -1 + timeline row removed.
 *  edit (revision snapshot -> receipt), gate `analyticsEditVersion`.
 *  voidcash-reverse (re-ring), gate `voidCashRetainedReversed`.
 *
 * Because the flag and all effects commit atomically, "endpoint fails -> cron ->
 * endpoint retry" ends in exactly the state "endpoint succeeds first" does: the
 * loser of the race sees the flag and no-ops.
 *
 * A receipt voided while its payment apply was still pending
 * (analyticsApplied:false) never had its sale projected, so there is no sale to
 * reverse — but the retained void cash is real drawer cash and is accrued, the
 * same net result as apply-then-void. Both flags are then set so neither the
 * payment nor the void path touches it again.
 */

export type ReceiptEventOp = "payment" | "refund" | "void" | "edit" | "voidcash-reverse";

export type ReceiptEventOptions = {
  /** Required for op "edit". */
  revisionId?: string;
  /** Required for op "voidcash-reverse". */
  reRingReceiptId?: string;
  /** "reconcile" stamps analyticsReconciledAt on the receipt. */
  source?: "endpoint" | "reconcile";
  now?: Date;
};

export type ReceiptEventResult = { skipped: boolean };

/** Marker for receipts whose effects were applied by this (complete) applier. */
export const EFFECTS_COMPLETE_FIELD = "analyticsEffectsComplete";

export function isVoidedReceipt(r: any): boolean {
  return r?.status === "voided" || r?.isVoided === true;
}

/** The receipt's pre-void shape: contribution functions return zero for a void. */
export function asOriginalReceipt(receipt: Receipt): Receipt {
  return {
    ...receipt,
    isVoided: false,
    status: (receipt as any).status === "voided" ? "final" : (receipt as any).status,
  } as Receipt;
}

/**
 * The analytics day that carries a receipt's retained void cash: its payment
 * day, exactly as applyAnalyticsDeltaServer and the rebuild bucket the sale.
 */
export function retainedCashDay(receipt: Receipt): { dayId: string; dayStartMs: number } | null {
  const c = getPaymentContribution(asOriginalReceipt(receipt));
  return c.dayId ? { dayId: c.dayId, dayStartMs: c.dayStartMs } : null;
}

/**
 * Running per-item order counts for the customer app's Popular group. Atomic
 * per-key increments, gated by the same receipt flags as the rest of the delta.
 * A nested map (not dotted paths) because keys are arbitrary inventory doc ids.
 */
export function writePopularityDelta(
  db: Firestore,
  storeId: string,
  delta: Record<string, number>,
  tx: { set(ref: any, data: any, options: any): unknown },
): void {
  const ids = Object.keys(delta);
  if (!ids.length) return;
  const counts: Record<string, unknown> = {};
  for (const id of ids) counts[id] = FieldValue.increment(delta[id]);
  tx.set(
    db.doc(`stores/${storeId}/catalogCache/popularItems`),
    { counts, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/** Day-doc-only accrual of retained void cash (no sale delta in this tx). */
function writeRetainedCash(
  db: Firestore,
  storeId: string,
  receipt: Receipt,
  amount: number,
  tx: Transaction,
): void {
  if (!(amount !== 0)) return;
  const day = retainedCashDay(receipt);
  if (!day) return;
  tx.set(
    db.doc(`stores/${storeId}/analytics/${day.dayId}`),
    {
      payments: { voidCashRetainedTotal: FieldValue.increment(amount) },
      meta: { storeId, dayId: day.dayId, dayStartMs: day.dayStartMs, updatedAt: FieldValue.serverTimestamp() },
    },
    { merge: true },
  );
}

/**
 * Applies one receipt event inside the caller's transaction. Performs all reads
 * first (receipt, store, revision / re-ring receipt), then all writes, and
 * writes the receipt doc exactly once.
 */
export async function applyReceiptEventInTx(
  db: Firestore,
  tx: Transaction,
  storeId: string,
  receiptId: string,
  op: ReceiptEventOp,
  opts: ReceiptEventOptions = {},
): Promise<ReceiptEventResult> {
  const now = opts.now ?? new Date();
  const receiptRef = db.doc(`stores/${storeId}/receipts/${receiptId}`);
  const snap = await tx.get(receiptRef);
  if (!snap.exists) throw new Error("Receipt not found.");
  const receipt = { id: receiptRef.id, ...(snap.data() as any) } as Receipt;
  const r = receipt as any;

  // ---- reads (all before any write) ----
  const needsStore = op === "payment" || op === "refund" || op === "edit";
  const storeSnap = needsStore ? await tx.get(db.doc(`stores/${storeId}`)) : null;
  const store = storeSnap?.exists ? ({ id: storeId, ...(storeSnap.data() as any) } as Store) : null;

  const stamp: Record<string, unknown> = {};
  if (opts.source === "reconcile") stamp.analyticsReconciledAt = FieldValue.serverTimestamp();

  /** Voided with no projected sale: accrue retained cash, close both gates. */
  const finishVoidWithoutSale = () => {
    writeRetainedCash(db, storeId, receipt, Number(r.voidCashRetained || 0), tx);
    removeDailySessionRow(db, storeId, receipt, tx);
    tx.update(receiptRef, {
      analyticsApplied: true,
      analyticsAppliedAt: FieldValue.serverTimestamp(),
      analyticsReversed: true,
      analyticsReversedAt: FieldValue.serverTimestamp(),
      [EFFECTS_COMPLETE_FIELD]: true,
      ...stamp,
    });
  };

  if (op === "void") {
    if (r.analyticsReversed === true) return { skipped: true };
    // The void flow commits status:"voided" BEFORE calling this op; a still-final
    // receipt means a forged/out-of-order call.
    if (!isVoidedReceipt(receipt)) throw new Error("Receipt is not voided; refusing to reverse its analytics.");
    if (r.analyticsApplied === false) {
      finishVoidWithoutSale();
      return { skipped: false };
    }
    if (r.analyticsApplied !== true) {
      // Legacy receipt without a flag: nothing known to reverse.
      tx.update(receiptRef, { analyticsReversed: true, analyticsReversedAt: FieldValue.serverTimestamp(), ...stamp });
      return { skipped: true };
    }
    const asOriginal = asOriginalReceipt(receipt);
    // Retained void cash = cash collected on this receipt that was NOT refunded
    // on void; it stays in the drawer with no backing sale. Day doc only,
    // merged into the reversal write (one write per doc per tx).
    const retained = Number(r.voidCashRetained || 0);
    applyAnalyticsDeltaServer(
      db, storeId, asOriginal, null, tx, now,
      retained > 0 ? { "payments.voidCashRetainedTotal": retained } : undefined,
    );
    writePopularityDelta(db, storeId, popularityDeltaFromReceipt(asOriginal, -1), tx);
    removeDailySessionRow(db, storeId, receipt, tx);
    tx.update(receiptRef, {
      analyticsReversed: true,
      analyticsReversedAt: FieldValue.serverTimestamp(),
      [EFFECTS_COMPLETE_FIELD]: true,
      ...stamp,
    });
    return { skipped: false };
  }

  if (op === "voidcash-reverse") {
    // A voided receipt's retained cash is being re-rung — the new receipt's sale
    // now covers that cash, so reverse the earlier retained-cash accrual.
    const reRingReceiptId = opts.reRingReceiptId ? String(opts.reRingReceiptId) : "";
    if (r.voidCashRetainedReversed === true) return { skipped: true };
    if (!isVoidedReceipt(receipt)) throw new Error("Receipt is not voided; nothing to re-ring.");
    if (!reRingReceiptId || reRingReceiptId.includes("/") || reRingReceiptId === receiptId) {
      throw new Error("Invalid reRingReceiptId.");
    }
    const reRingRef = db.doc(`stores/${storeId}/receipts/${reRingReceiptId}`);
    const reRingSnap = await tx.get(reRingRef);
    if (!reRingSnap.exists) throw new Error("Re-ring receipt not found.");
    const reRing = reRingSnap.data() as any;
    if (isVoidedReceipt(reRing) || reRing?.status !== "final") throw new Error("Re-ring receipt is not a final receipt.");
    if (reRing?.isRefund === true) throw new Error("Re-ring receipt cannot be a refund.");
    if (reRing?.storeId && reRing.storeId !== storeId) throw new Error("Re-ring receipt belongs to another store.");
    if (reRing?.reRingOfReceiptId && reRing.reRingOfReceiptId !== receiptId) {
      throw new Error("Re-ring receipt is already linked to another voided receipt.");
    }
    tx.update(reRingRef, { reRingOfReceiptId: receiptId });
    const retained = Number(r.voidCashRetained || 0);
    if (retained > 0) writeRetainedCash(db, storeId, receipt, -retained, tx);
    tx.update(receiptRef, {
      voidCashRetainedReversed: true,
      reRingReceiptId,
      reRingLinkedAt: FieldValue.serverTimestamp(),
    });
    return { skipped: !(retained > 0) };
  }

  if (op === "edit") {
    const revisionId = String(opts.revisionId || "");
    if (!revisionId) throw new Error("Missing revisionId for edit.");
    const revRef = db.doc(`stores/${storeId}/receipts/${receiptId}/revisions/${revisionId}`);
    const revSnap = await tx.get(revRef);
    if (!revSnap.exists) throw new Error("Revision not found.");
    const rev = revSnap.data() as any;
    const version = Number(rev?.version || 0);
    const oldReceipt = rev?.snapshot as Receipt | undefined;
    if (!oldReceipt) throw new Error("Revision snapshot missing.");
    if (version > 0 && Number(r.analyticsEditVersion || 0) >= version) return { skipped: true };
    applyAnalyticsDeltaServer(db, storeId, oldReceipt, receipt, tx, now);
    // Netted into one write: two set-merges on one doc in one tx don't compound.
    writePopularityDelta(
      db,
      storeId,
      mergePopularityDeltas(popularityDeltaFromReceipt(oldReceipt, -1), popularityDeltaFromReceipt(receipt, 1)),
      tx,
    );
    upsertDailySessionRow(db, storeId, receipt, store, tx);
    tx.update(receiptRef, {
      analyticsEditVersion: version,
      analyticsEditAppliedAt: FieldValue.serverTimestamp(),
    });
    return { skipped: false };
  }

  // op === "payment" | "refund": apply null -> receipt.
  if (r.analyticsApplied === true) return { skipped: true };
  if (isVoidedReceipt(receipt)) {
    // Voided before its payment was ever projected. Its sale contributes zero.
    if (r.analyticsReversed === false) {
      finishVoidWithoutSale();
      return { skipped: false };
    }
    tx.update(receiptRef, { analyticsApplied: true, analyticsAppliedAt: FieldValue.serverTimestamp(), ...stamp });
    return { skipped: true };
  }
  applyAnalyticsDeltaServer(db, storeId, null, receipt, tx, now);
  writePopularityDelta(db, storeId, popularityDeltaFromReceipt(receipt, 1), tx);
  upsertDailySessionRow(db, storeId, receipt, store, tx);
  tx.update(receiptRef, {
    analyticsApplied: true,
    analyticsAppliedAt: FieldValue.serverTimestamp(),
    [EFFECTS_COMPLETE_FIELD]: true,
    ...stamp,
  });
  return { skipped: false };
}

/** Runs applyReceiptEventInTx in its own transaction. */
export function applyReceiptEvent(
  db: Firestore,
  storeId: string,
  receiptId: string,
  op: ReceiptEventOp,
  opts: ReceiptEventOptions = {},
): Promise<ReceiptEventResult> {
  return db.runTransaction((tx) => applyReceiptEventInTx(db, tx, storeId, receiptId, op, opts));
}
