import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";

export const runtime = "nodejs";

function resolveGuestCountLimit(active: Record<string, any>): number {
  if (active?.guestCountFinal != null) return Number(active.guestCountFinal) || 1;
  if (active?.guestCountCashierInitial != null) return Number(active.guestCountCashierInitial) || 1;
  if (active?.guestCount != null) return Number(active.guestCount) || 1;
  return 1;
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
    }

    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const body = await request.json();
    const storeId = String(body?.storeId || "");
    const targetSessionId = body?.sessionId ? String(body.sessionId) : null;
    if (!storeId) {
      return NextResponse.json({ error: "storeId is required." }, { status: 400 });
    }

    const adminDb = getAdminDb();
    const { uid: actorUid } = await requireStaffStoreAccess(adminDb, decoded, storeId, ["admin", "manager"]);

    // Find active pins — targeted to one session or all for this store
    let pinsQuery = adminDb
      .collection("pinRegistry")
      .where("storeId", "==", storeId)
      .where("status", "==", "active");

    if (targetSessionId) {
      pinsQuery = pinsQuery.where("sessionId", "==", targetSessionId) as any;
    }

    const pinsSnap = await pinsQuery.get();

    if (pinsSnap.empty) {
      return NextResponse.json({ repaired: 0, message: "No active pins found in registry." });
    }

    const batch = adminDb.batch();
    let repaired = 0;

    for (const pinDoc of pinsSnap.docs) {
      const pinData = pinDoc.data() as any;
      const sessionId = pinData?.sessionId;
      if (!sessionId) continue;

      const activeSessionRef = adminDb.doc(`stores/${storeId}/activeSessions/${sessionId}`);
      const activeSnap = await activeSessionRef.get();
      if (!activeSnap.exists) continue;

      const activeData = activeSnap.data() as any;
      // Only repair if customerPin is missing/null
      if (activeData?.customerPin) continue;

      batch.set(
        activeSessionRef,
        {
          customerPin: pinData.pin,
          customerAccessEnabled: true,
          customerAccessExpiresAtMs: pinData.expiresAtMs ?? Date.now() + 2 * 60 * 60 * 1000,
          customerName: activeData?.customerName ?? pinData?.customerName ?? null,
          customerParticipantLimit: resolveGuestCountLimit(activeData),
          customerParticipantActiveCount: 0,
          updatedAt: FieldValue.serverTimestamp(),
          repairedAt: FieldValue.serverTimestamp(),
          repairedByUid: actorUid,
        },
        { merge: true }
      );
      repaired++;
    }

    if (repaired > 0) await batch.commit();

    return NextResponse.json({ repaired, message: `Repaired ${repaired} session(s).` });
  } catch (e: any) {
    console.error("[api/pins/repair] failed:", e);
    const message = e?.message || "Repair failed.";
    const status =
      /Missing bearer token|verifyIdToken|Invalid token/i.test(message) ? 401 :
      /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
      /required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
