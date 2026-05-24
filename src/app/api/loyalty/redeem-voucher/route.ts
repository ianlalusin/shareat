import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { applyLoyaltyVoucher } from "@/lib/server/loyalty";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

// Apply a Hub-issued voucher (by code) to the current session.
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded: any;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    return bad("Invalid token.", 401);
  }
  const uid = decoded.uid;
  if (!uid) return bad("Invalid token.", 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const storeId = String(body.storeId || "");
  const sessionId = String(body.sessionId || "");
  const code = String(body.code || "");
  if (!storeId || !sessionId || !code) return bad("Missing required fields.");

  const db = getAdminDb();
  const staffSnap = await db.doc(`staff/${uid}`).get();
  if (!staffSnap.exists) return bad("Not a staff member.", 403);
  const staffData = staffSnap.data() as any;
  if (staffData.status !== "active") return bad("Staff not active.", 403);
  const assigned: string[] = Array.isArray(staffData.assignedStoreIds) ? staffData.assignedStoreIds : [];
  const isAdmin = staffData.role === "admin" || decoded.platformAdmin === true;
  if (!isAdmin && !assigned.includes(storeId)) return bad("No access to this store.", 403);

  const result = await applyLoyaltyVoucher({ storeId, sessionId, code, staffUid: uid });
  if (!result.ok) {
    const status = /not found|already|expired|limit|claimed/i.test(result.error || "") ? 400 : 500;
    return bad(result.error || "Failed to apply voucher.", status);
  }
  return NextResponse.json({ ok: true, redemptionId: result.redemptionId, reward: result.reward });
}
