import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { endAllParticipants } from "@/lib/server/customer-participants";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });

    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const body = await request.json();
    const storeId = String(body?.storeId || "");
    const sessionId = String(body?.sessionId || "");
    if (!storeId || !sessionId) return NextResponse.json({ error: "storeId and sessionId required." }, { status: 400 });

    const adminDb = getAdminDb();
    const { uid: actorUid } = await requireStaffStoreAccess(adminDb, decoded, storeId, ["admin", "manager", "cashier"]);

    const revokedCount = await endAllParticipants(adminDb, storeId, sessionId, "revoked", actorUid, "manual_reset");

    await adminDb.doc(`stores/${storeId}/activeSessions/${sessionId}`).set({
      customerParticipantActiveCount: 0,
      customerJoinVersion: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ ok: true, revokedCount });
  } catch (e: any) {
    const message = e?.message || "Reset failed.";
    const status =
      /Missing bearer token|verifyIdToken|Invalid token/i.test(message) ? 401 :
      /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
      /required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
