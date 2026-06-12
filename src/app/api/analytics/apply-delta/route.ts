import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { applyAnalyticsDeltaServer } from "@/lib/server/analytics/applyAnalyticsDeltaServer";
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
const SUPPORTED_OPS = new Set(["payment", "refund", "void"]);

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
        applyAnalyticsDeltaServer(db, storeId, asOriginal, null, tx, new Date());
        tx.update(receiptRef, {
          analyticsReversed: true,
          analyticsReversedAt: FieldValue.serverTimestamp(),
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
