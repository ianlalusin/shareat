import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { applyAnalyticsDeltaServer } from "@/lib/server/analytics/applyAnalyticsDeltaServer";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import type { Receipt } from "@/lib/types";

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

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

async function verifyToken(req: Request): Promise<DecodedIdToken> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing bearer token.");
  try {
    return await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    throw new Error("Invalid token.");
  }
}

function mapError(e: any) {
  const message = e?.message || "Request failed.";
  const status =
    /Missing bearer token|Invalid token/i.test(message) ? 401 :
    /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
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

      if (op === "void") {
        // Already reversed → no-op (idempotent across server + client fallback).
        if ((receipt as any).analyticsReversed === true) return { skipped: true as const };
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
        const reRingReceiptId = body.reRingReceiptId ? String(body.reRingReceiptId) : null;
        if ((receipt as any).voidCashRetainedReversed === true) return { skipped: true as const };
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
      tx.update(receiptRef, { analyticsApplied: true, analyticsAppliedAt: FieldValue.serverTimestamp() });
      return { skipped: false as const };
    });

    return NextResponse.json({ ok: true, applied: !result.skipped, skipped: result.skipped, op });
  } catch (e) {
    return mapError(e);
  }
}
