import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import {
  applyReceiptEventInTx,
  type ReceiptEventOp,
} from "@/lib/server/analytics/receiptEventApplier";

export const runtime = "nodejs";

/**
 * Server-side analytics delta application. Recomputes the delta from the receipt
 * doc itself (never trusts client totals) and applies it idempotently.
 *
 * Ops (payment/refund, void, edit, voidcash-reverse) and their idempotency
 * gates are documented on the shared applier in
 * src/lib/server/analytics/receiptEventApplier.ts — the reconcile cron runs the
 * same function, so either path leaves identical state.
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

    // All effects live in the shared applier (B23) so the reconcile cron
    // produces exactly the same state when it wins the race.
    const result = await db.runTransaction((tx) =>
      applyReceiptEventInTx(db, tx, storeId, receiptId, op as ReceiptEventOp, {
        revisionId: body.revisionId ? String(body.revisionId) : undefined,
        reRingReceiptId: body.reRingReceiptId ? String(body.reRingReceiptId) : undefined,
        source: "endpoint",
      }),
    );

    return NextResponse.json({ ok: true, applied: !result.skipped, skipped: result.skipped, op });
  } catch (e) {
    return mapError(e);
  }
}
