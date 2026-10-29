import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { applyAnalyticsDeltaServer } from "@/lib/server/analytics/applyAnalyticsDeltaServer";
import {
  removeDailySessionRow,
  upsertDailySessionRow,
} from "@/lib/server/analytics/applyDailySessionRowServer";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import {
  mergePopularityDeltas,
  popularityDeltaFromReceipt,
} from "@/lib/analytics/popular-items";
import type { Receipt, Store } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Server-side analytics delta application. Recomputes the delta from the receipt
 * doc itself (never trusts client totals) and applies it idempotently.
 *
 * Supported ops:
 *  - "payment" / "refund": apply (null -> receipt). Idempotent on `analyticsApplied`.
 *    A refund is just a (negative-total / isRefund) receipt, so it shares the
 *    exact null->receipt path. Sets analyticsApplied:true.
 *  - "void": reverse (receipt -> null). The contribution functions return zero
 *    for a voided receipt (isVoidReceipt), so we reconstruct the receipt's
 *    ORIGINAL pre-void contribution by neutralizing the voided flag before
 *    reversing. Idempotent on `analyticsReversed`, gated on `analyticsApplied`
 *    (nothing to reverse if it was never applied).
 *
 * "edit" still needs old+new reconstruction (the edit overwrites the doc) and is
 * not yet supported here — it is moved server-side in a later increment.
 */
const SUPPORTED_OPS = new Set(["payment", "refund", "void", "edit", "voidcash-reverse"]);

/**
 * Running per-item order counts, for the customer app's Popular group.
 *
 * Written as atomic per-key increments inside the caller's transaction, gated
 * by the same `analyticsApplied` / `analyticsReversed` flags as the rest of the
 * delta — so a retry, an offline replay, or the client fallback path cannot
 * double-count. A nested map (not dotted "counts.<id>" paths) because the keys
 * are arbitrary inventory doc ids.
 */
function writePopularityDelta(
  db: FirebaseFirestore.Firestore,
  storeId: string,
  delta: Record<string, number>,
  tx: FirebaseFirestore.Transaction
): void {
  const ids = Object.keys(delta);
  if (!ids.length) return;

  const counts: Record<string, unknown> = {};
  for (const id of ids) counts[id] = FieldValue.increment(delta[id]);

  tx.set(
    db.doc(`stores/${storeId}/catalogCache/popularItems`),
    { counts, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

function isVoided(r: any): boolean {
  return r?.status === "voided" || r?.isVoided === true;
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

async function verifyToken(req: Request): Promise<DecodedIdToken> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing bearer token.");
  try {
    return await getAdminAuth().verifyIdToken(match[1], true);
  } catch {
    throw new Error("Invalid token.");
  }
}

function mapError(e: any) {
  const message = e?.message || "Request failed.";
  const status =
    /Missing bearer token|Invalid token/i.test(message) ? 401 :
    /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
    /not voided|nothing to re-ring|re-ring|reRingReceiptId/i.test(message) ? 409 :
    500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const storeId = String(body.storeId || "");
  const receiptId = String(body.receiptId || "");
  const op = String(body.op || "");
  if (!storeId || !receiptId || !op) return bad("Missing storeId, receiptId, or op.");

  if (!SUPPORTED_OPS.has(op)) {
    return NextResponse.json(
      { ok: false, error: `op '${op}' not yet supported server-side.`, op },
      { status: 501 }
    );
  }

  try {
    const decoded = await verifyToken(req);
    const db = getAdminDb();
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);

    const receiptRef = db.doc(`stores/${storeId}/receipts/${receiptId}`);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(receiptRef);
      if (!snap.exists) throw new Error("Receipt not found.");
      const receipt = { id: receiptRef.id, ...(snap.data() as any) } as Receipt;

      // The session-timeline row needs the store's tax mode to split bill-level
      // from line-level discounts. Read it here, with the receipt, so every read
      // in this transaction still precedes every write. Ops that only remove a
      // row (void) or touch a counter (voidcash-reverse) skip the read.
      const needsStore = op === "payment" || op === "refund" || op === "edit";
      const storeSnap = needsStore ? await tx.get(db.doc(`stores/${storeId}`)) : null;
      const store = storeSnap?.exists
        ? ({ id: storeId, ...(storeSnap.data() as any) } as Store)
        : null;

      if (op === "void") {
        // Already reversed → no-op (idempotent across server + client fallback).
        if ((receipt as any).analyticsReversed === true) return { skipped: true as const };
        // Only a receipt that has actually been voided may be reversed. The
        // void flow commits status:"voided" (in its own transaction) BEFORE
        // calling this op, so a still-final receipt means a forged/out-of-order
        // call — reversing it would delete a real sale from analytics.
        if (!isVoided(receipt)) throw new Error("Receipt is not voided; refusing to reverse its analytics.");
        // Nothing was ever applied → nothing to reverse; mark so we stay consistent.
        if ((receipt as any).analyticsApplied !== true) {
          tx.update(receiptRef, {
            analyticsReversed: true,
            analyticsReversedAt: FieldValue.serverTimestamp(),
          });
          return { skipped: true as const };
        }
        // Reconstruct the original (pre-void) contribution: the contribution
        // functions return zero for a voided receipt, so neutralize the flag.
        const asOriginal = {
          ...receipt,
          isVoided: false,
          status: (receipt as any).status === "voided" ? "final" : (receipt as any).status,
        } as Receipt;
        // Retained void cash = cash collected on this receipt that was NOT refunded
        // when it was voided. It stays in the drawer with no backing sale, so it is
        // accumulated on the day doc (daily-remittance only) for the ERP to carry
        // into expected cash. Merged into the sale-reversal write (one write/doc/tx).
        const retained = Number((receipt as any).voidCashRetained || 0);
        applyAnalyticsDeltaServer(
          db, storeId, asOriginal, null, tx, new Date(),
          retained > 0 ? { "payments.voidCashRetainedTotal": retained } : undefined,
        );
        writePopularityDelta(db, storeId, popularityDeltaFromReceipt(asOriginal, -1), tx);
        // The timeline lists closed/paid sessions only, so a void drops the row.
        removeDailySessionRow(db, storeId, receipt, tx);
        tx.update(receiptRef, {
          analyticsReversed: true,
          analyticsReversedAt: FieldValue.serverTimestamp(),
        });
        return { skipped: false as const };
      }

      if (op === "voidcash-reverse") {
        // A voided receipt's retained cash is being re-rung — a new (correct)
        // receipt now covers that cash, so its sale will count in the day totals.
        // Reverse the earlier retained-cash accrual so expected cash isn't
        // double-counted (retained + the re-ring sale). Idempotent on
        // analytics-flag voidCashRetainedReversed.
        const reRingReceiptId = body.reRingReceiptId ? String(body.reRingReceiptId) : "";
        if ((receipt as any).voidCashRetainedReversed === true) return { skipped: true as const };
        if (!isVoided(receipt)) throw new Error("Receipt is not voided; nothing to re-ring.");
        // The re-ring must be a genuine replacement: an existing, final,
        // non-refund receipt of THIS store (same collection path), other than
        // the voided one, not already linked to a different voided receipt.
        if (!reRingReceiptId || reRingReceiptId.includes("/") || reRingReceiptId === receiptId) {
          throw new Error("Invalid reRingReceiptId.");
        }
        const reRingRef = db.doc(`stores/${storeId}/receipts/${reRingReceiptId}`);
        const reRingSnap = await tx.get(reRingRef);
        if (!reRingSnap.exists) throw new Error("Re-ring receipt not found.");
        const reRing = reRingSnap.data() as any;
        if (isVoided(reRing) || reRing?.status !== "final") throw new Error("Re-ring receipt is not a final receipt.");
        if (reRing?.isRefund === true) throw new Error("Re-ring receipt cannot be a refund.");
        if (reRing?.storeId && reRing.storeId !== storeId) throw new Error("Re-ring receipt belongs to another store.");
        if (reRing?.reRingOfReceiptId && reRing.reRingOfReceiptId !== receiptId) {
          throw new Error("Re-ring receipt is already linked to another voided receipt.");
        }
        tx.update(reRingRef, { reRingOfReceiptId: receiptId });
        const retained = Number((receipt as any).voidCashRetained || 0);
        if (!(retained > 0)) {
          tx.update(receiptRef, {
            voidCashRetainedReversed: true,
            reRingReceiptId,
            reRingLinkedAt: FieldValue.serverTimestamp(),
          });
          return { skipped: true as const };
        }
        const dayId = getDayIdFromTimestamp((receipt as any).createdAtClientMs ?? null);
        const dayRef = db.doc(`stores/${storeId}/analytics/${dayId}`);
        tx.set(
          dayRef,
          {
            payments: { voidCashRetainedTotal: FieldValue.increment(-retained) },
            meta: { updatedAt: FieldValue.serverTimestamp() },
          },
          { merge: true },
        );
        tx.update(receiptRef, {
          voidCashRetainedReversed: true,
          reRingReceiptId,
          reRingLinkedAt: FieldValue.serverTimestamp(),
        });
        return { skipped: false as const };
      }

      if (op === "edit") {
        // Old state = the revision snapshot the client wrote; new state = the
        // (already-committed) edited receipt doc. Both server-read, so totals are
        // never trusted from the request. Idempotent on analyticsEditVersion.
        const revisionId = String(body.revisionId || "");
        if (!revisionId) throw new Error("Missing revisionId for edit.");
        const revRef = db.doc(`stores/${storeId}/receipts/${receiptId}/revisions/${revisionId}`);
        const revSnap = await tx.get(revRef);
        if (!revSnap.exists) throw new Error("Revision not found.");
        const rev = revSnap.data() as any;
        const version = Number(rev?.version || 0);
        const oldReceipt = rev?.snapshot as Receipt | undefined;
        if (!oldReceipt) throw new Error("Revision snapshot missing.");
        if (version > 0 && Number((receipt as any).analyticsEditVersion || 0) >= version) {
          return { skipped: true as const };
        }
        applyAnalyticsDeltaServer(db, storeId, oldReceipt, receipt, tx, new Date());
        // An edit is "un-count the old lines, count the new ones". Netted into
        // a single write because two set-with-merge calls on one document in
        // one transaction do not compound their increments.
        writePopularityDelta(
          db,
          storeId,
          mergePopularityDeltas(
            popularityDeltaFromReceipt(oldReceipt, -1),
            popularityDeltaFromReceipt(receipt, 1)
          ),
          tx
        );
        // Re-derive the row from the edited receipt (same close time, so it
        // overwrites in place on the same day doc).
        upsertDailySessionRow(db, storeId, receipt, store, tx);
        tx.update(receiptRef, {
          analyticsEditVersion: version,
          analyticsEditAppliedAt: FieldValue.serverTimestamp(),
        });
        return { skipped: false as const };
      }

      // op === "payment" | "refund": apply null -> receipt.
      if ((receipt as any).analyticsApplied === true) {
        return { skipped: true as const };
      }
      applyAnalyticsDeltaServer(db, storeId, null, receipt, tx, new Date());
      writePopularityDelta(db, storeId, popularityDeltaFromReceipt(receipt, 1), tx);
      upsertDailySessionRow(db, storeId, receipt, store, tx);
      tx.update(receiptRef, { analyticsApplied: true, analyticsAppliedAt: FieldValue.serverTimestamp() });
      return { skipped: false as const };
    });

    return NextResponse.json({ ok: true, applied: !result.skipped, skipped: result.skipped, op });
  } catch (e) {
    return mapError(e);
  }
}
