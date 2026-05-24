import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { writeLoyaltyRedeem, reverseLoyaltyRedeem } from "@/lib/server/loyalty";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

async function requireStaff(req: Request, storeId?: string) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: bad("Missing bearer token.", 401) };
  let decoded: any;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    return { error: bad("Invalid token.", 401) };
  }
  const uid = decoded.uid;
  if (!uid) return { error: bad("Invalid token.", 401) };

  const db = getAdminDb();
  const staffSnap = await db.doc(`staff/${uid}`).get();
  if (!staffSnap.exists) return { error: bad("Not a staff member.", 403) };
  const staffData = staffSnap.data() as any;
  if (staffData.status !== "active") return { error: bad("Staff not active.", 403) };
  const assigned: string[] = Array.isArray(staffData.assignedStoreIds) ? staffData.assignedStoreIds : [];
  const isAdmin = staffData.role === "admin" || decoded.platformAdmin === true;
  if (storeId && !isAdmin && !assigned.includes(storeId)) {
    return { error: bad("No access to this store.", 403) };
  }
  return { uid };
}

// Apply a reward: debit points + create an applied redemption linked to the session.
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const storeId = String(body.storeId || "");
  const sessionId = String(body.sessionId || "");
  const phone = String(body.phone || "");
  const rewardId = String(body.rewardId || "");
  if (!storeId || !sessionId || !phone || !rewardId) return bad("Missing required fields.");

  const auth = await requireStaff(req, storeId);
  if ("error" in auth) return auth.error;

  const result = await writeLoyaltyRedeem({ storeId, sessionId, phone, rewardId, staffUid: auth.uid });
  if (!result.ok) return bad(result.error || "Failed to redeem.", result.error === "Insufficient points" ? 400 : 500);
  return NextResponse.json({ ok: true, redemptionId: result.redemptionId, code: result.code, reward: result.reward });
}

// Reverse a redemption (cashier removes the reward before payment).
export async function DELETE(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const redemptionId = String(body.redemptionId || "");
  if (!redemptionId) return bad("Missing redemptionId.");

  const auth = await requireStaff(req);
  if ("error" in auth) return auth.error;

  const result = await reverseLoyaltyRedeem(redemptionId, auth.uid, String(body.reason || "removed"));
  if (!result.ok) return bad(result.error || "Failed to reverse.", 500);
  return NextResponse.json({ ok: true, refunded: result.refunded });
}
