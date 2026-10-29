import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { reverseLoyaltyForReceipt } from "@/lib/server/loyalty";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * Undo loyalty on a PAID receipt after it was voided or refunded (B07):
 * take back the points it earned and return vouchers used on it.
 * Body: { storeId, receiptId, reason: "receipt_void" | "refund", refundReceiptId? }
 * receiptId is always the ORIGINAL sale receipt. Idempotent.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1], true);
  } catch {
    return bad("Invalid token.", 401);
  }
  if (!decoded?.uid) return bad("Invalid token.", 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const storeId = String(body.storeId || "");
  const receiptId = String(body.receiptId || "");
  const reason = String(body.reason || "");
  const refundReceiptId = body.refundReceiptId ? String(body.refundReceiptId) : undefined;
  if (!storeId || !receiptId) return bad("Missing required fields.");
  if (reason !== "receipt_void" && reason !== "refund") return bad("Invalid reason.");
  if (reason === "refund" && !refundReceiptId) return bad("Missing refundReceiptId.");

  // Voiding / refunding a paid receipt is a manager action (same as the
  // receipts page buttons and the paid-reversal branch of /api/loyalty/redeem).
  try {
    await requireStaffStoreAccess(getAdminDb(), decoded, storeId, ["admin", "manager"]);
  } catch (e: any) {
    const message = e?.message || "Forbidden.";
    return bad(message, /Invalid token/i.test(message) ? 401 : 403);
  }

  const result = await reverseLoyaltyForReceipt({ storeId, receiptId, reason, refundReceiptId, staffUid: decoded.uid });
  return NextResponse.json(
    {
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
      points: { reversed: result.earn.reversed ?? 0, shortfall: result.earn.shortfall ?? 0, ...(result.earn.noEarn ? { noEarn: true } : {}), ...(result.earn.duplicate ? { duplicate: true } : {}) },
      vouchers: result.vouchers,
    },
    { status: result.ok ? 200 : result.status ?? 500 },
  );
}
