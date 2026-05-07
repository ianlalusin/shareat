import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { getManilaDayId } from "@/lib/pins/day-id";
import { endAllParticipants } from "@/lib/server/customer-participants";
import { writeServerActivityLog } from "@/lib/server/write-activity-log";

export const runtime = "nodejs";

type FinalizeReason = "manual_disable" | "payment_closed" | "session_voided" | "expired_cleanup" | "reissued";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
    }

    const decoded = await getAdminAuth().verifyIdToken(match[1]);
    const actorUid = decoded.uid;

    const body = await request.json();
    const storeId = String(body?.storeId || "");
    const sessionId = String(body?.sessionId || "");
    const pin = body?.pin ? String(body.pin) : "";
    const reason = String(body?.reason || "manual_disable") as FinalizeReason;

    if (!storeId || !sessionId) {
      return NextResponse.json({ error: "storeId and sessionId are required." }, { status: 400 });
    }

    const allowedReasons = new Set<FinalizeReason>([
      "manual_disable",
      "payment_closed",
      "session_voided",
      "expired_cleanup",
      "reissued",
    ]);
    if (!allowedReasons.has(reason)) {
      return NextResponse.json({ error: "Invalid finalize reason." }, { status: 400 });
    }

    const adminDb = getAdminDb();
    const activeSessionRef = adminDb.doc(`stores/${storeId}/activeSessions/${sessionId}`);
    const staffRef = adminDb.doc(`staff/${actorUid}`);

    const result = await adminDb.runTransaction(async (tx) => {
      const [activeSnap, staffSnap] = await Promise.all([
        tx.get(activeSessionRef),
        tx.get(staffRef),
      ]);

      const staff = staffSnap.exists ? (staffSnap.data() as any) : null;
      const role = String(staff?.role || "");
      if (!["admin", "manager", "cashier"].includes(role)) {
        throw new Error("You are not allowed to finalize PINs.");
      }

      let currentPin = pin;
      const activeData = activeSnap.exists ? (activeSnap.data() as any) : null;
      if (!currentPin && activeData?.customerPin) {
        currentPin = String(activeData.customerPin);
      }

      const nowMs = Date.now();
      const dayId = getManilaDayId(nowMs);

      if (currentPin) {
        const pinRef = adminDb.doc(`pinRegistry/${currentPin}`);
        const pinSnap = await tx.get(pinRef);

        if (pinSnap.exists) {
          tx.set(
            adminDb.doc(`stores/${storeId}/pinArchiveByDay/${dayId}/pins/${currentPin}`),
            {
              ...pinSnap.data(),
              pin: currentPin,
              storeId,
              sessionId,
              customerName: pinSnap.data()?.customerName ?? activeData?.customerName ?? null,
              tableDisplayName: pinSnap.data()?.tableDisplayName ?? activeData?.tableDisplayName ?? null,
              tableNumber: pinSnap.data()?.tableNumber ?? activeData?.tableNumber ?? activeData?.tableDisplayName ?? null,
              archivedAt: FieldValue.serverTimestamp(),
              archivedByUid: actorUid,
              archiveReason: reason,
              originalStatus: pinSnap.data()?.status || "active",
              status: "archived",
            },
            { merge: true }
          );
          tx.update(pinRef, {
            status: "archived",
            archivedAtMs: nowMs,
            archivedAt: FieldValue.serverTimestamp(),
            archivedByUid: actorUid,
            archiveReason: reason,
          });
        }
      }

      if (activeSnap.exists) {
        tx.set(
          activeSessionRef,
          {
            customerAccessEnabled: false,
            customerPin: null,
            customerAccessExpiresAtMs: null,
            customerJoinVersion: FieldValue.increment(1),
            customerParticipantActiveCount: 0,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return { ok: true, pin: currentPin || null, reason, archivedDayId: dayId };
    });

    const revokedCount = await endAllParticipants(adminDb, storeId, sessionId, "ended", actorUid, `finalize_${reason}`);
    await writeServerActivityLog(adminDb, {
      storeId, sessionId, actorUid,
      action: "CUSTOMER_PARTICIPANTS_RESET",
      meta: { revokedCount, reason },
      dayId: getManilaDayId(Date.now()),
    });

    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[api/pins/finalize] failed:", e);
    const message = e?.message || "Failed to finalize PIN.";
    const status =
      /Missing bearer token|verifyIdToken/i.test(message) ? 401 :
      /not allowed/i.test(message) ? 403 :
      /required|invalid/i.test(message) ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
