import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { endAllParticipants } from "@/lib/server/customer-participants";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });

    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const actorUid = decoded.uid;

    const body = await request.json();
    const storeId = String(body?.storeId || "");
    const sessionId = String(body?.sessionId || "");
    if (!storeId || !sessionId) return NextResponse.json({ error: "storeId and sessionId required." }, { status: 400 });

    const adminDb = getAdminDb();
    const staffSnap = await adminDb.doc(`staff/${actorUid}`).get();
    const role = String(staffSnap.exists ? (staffSnap.data() as any)?.role : "");
    if (!["admin", "manager", "cashier"].includes(role)) {
      return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    }

    const revokedCount = await endAllParticipants(adminDb, storeId, sessionId, "revoked", actorUid, "manual_reset");

    await adminDb.doc(`stores/${storeId}/activeSessions/${sessionId}`).set({
      customerParticipantActiveCount: 0,
      customerJoinVersion: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ ok: true, revokedCount });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Reset failed." }, { status: 500 });
  }
}
