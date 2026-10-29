import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * Dine-in visit count for the customer behind ONE online order of this store
 * (the "trust signal" on the Online Orders screen).
 *
 * Replaces OnlineOrdersClient's direct client read of customers/{phone}, which
 * needed a rules grant letting any active staffer fetch any customer's whole
 * document (passwordHash and cross-branch PII included) by phone (audit B05,
 * 2026-10-29). This route is store-scoped twice over: the caller must be
 * assigned to storeId, and the phone is taken from an order that belongs to
 * that store, never from the request — so it cannot be used to probe
 * arbitrary numbers. Only visitCount leaves the server.
 *
 * Response: { ok: true, visitCount: number | null } — null means the order has
 * a valid phone but no loyalty record exists (a genuine miss).
 */
export async function GET(req: Request) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1], true);
  } catch {
    return bad("Invalid token.", 401);
  }

  const url = new URL(req.url);
  const storeId = String(url.searchParams.get("storeId") || "").trim();
  const orderId = String(url.searchParams.get("orderId") || "").trim();
  if (!storeId || storeId.includes("/")) return bad("storeId is required.");
  if (!orderId || orderId.includes("/")) return bad("orderId is required.");

  const db = getAdminDb();
  try {
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);
  } catch (err: any) {
    return bad(err?.message || "Not allowed.", 403);
  }

  const orderSnap = await db.doc(`stores/${storeId}/onlineOrders/${orderId}`).get();
  if (!orderSnap.exists) return bad("Order not found.", 404);

  const phone = normalizePhone(String((orderSnap.data() as any)?.contact?.phone || ""));
  if (!phone) return bad("Order has no valid phone.", 404);

  const customerSnap = await db.doc(`customers/${phone}`).get();
  const visitCount = customerSnap.exists
    ? Number((customerSnap.data() as any)?.visitCount ?? 0) || 0
    : null;

  return NextResponse.json({ ok: true, visitCount });
}
