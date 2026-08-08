import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { writeLoyaltyEarn } from "@/lib/server/loyalty";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
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
  const phone = String(body.phone || "");
  const amount = Number(body.amount || 0);
  const receiptId = body.receiptId ? String(body.receiptId) : undefined;

  if (!storeId || !sessionId || !phone || amount <= 0) {
    return bad("Missing required fields.");
  }

  // Verify staff has access to this store
  const db = getAdminDb();
  const staffSnap = await db.doc(`staff/${uid}`).get();
  if (!staffSnap.exists) return bad("Not a staff member.", 403);
  const staffData = staffSnap.data() as any;
  if (staffData.status !== "active") return bad("Staff not active.", 403);
  const assignedStoreIds: string[] = Array.isArray(staffData.assignedStoreIds) ? staffData.assignedStoreIds : [];
  const isAdmin = staffData.role === "admin" || decoded.platformAdmin === true;
  if (!isAdmin && !assignedStoreIds.includes(storeId)) {
    return bad("No access to this store.", 403);
  }

  const result = await writeLoyaltyEarn({
    storeId,
    sessionId,
    phone,
    amount,
    receiptId,
    staffUid: uid,
  });

  if (!result.ok) return bad(result.error || "Failed to earn points.", 500);
  return NextResponse.json({ ok: true, points: result.points });
}
