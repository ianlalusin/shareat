import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { applyAnalyticsDeltaServer } from "@/lib/server/analytics/applyAnalyticsDeltaServer";
import type { Receipt } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Server-side analytics delta application (Stage A groundwork — NOT yet wired
 * into the client). Recomputes the delta from the receipt doc itself (never
 * trusts client totals) and applies it idempotently.
 *
 * Currently only `op: "payment"` is implemented (null -> receipt, idempotent on
 * analyticsApplied). void / edit / refund need old-state reconstruction and must
 * be implemented and verified against real receipts in Stage B before the client
 * is switched over.
 */
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

  if (op !== "payment") {
    return NextResponse.json(
      { ok: false, error: `op '${op}' not yet supported server-side. Implement and verify in Stage B.`, op },
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

      if ((receipt as any).analyticsApplied === true) {
        return { skipped: true as const };
      }

      applyAnalyticsDeltaServer(db, storeId, null, receipt, tx, new Date());
      tx.update(receiptRef, { analyticsApplied: true, analyticsAppliedAt: FieldValue.serverTimestamp() });
      return { skipped: false as const };
    });

    return NextResponse.json({ ok: true, applied: !result.skipped, skipped: result.skipped });
  } catch (e) {
    return mapError(e);
  }
}
