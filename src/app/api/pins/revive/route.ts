import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { getManilaDayId } from "@/lib/pins/day-id";

export const runtime = "nodejs";

const PIN_TTL_MS = 30 * 60 * 1000; // 30 minutes

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
    const pin = String(body?.pin || "");
    const dayId = String(body?.dayId || getManilaDayId(Date.now()));

    if (!storeId || !sessionId || !pin) {
      return NextResponse.json({ error: "storeId, sessionId, and pin are required." }, { status: 400 });
    }

    const adminDb = getAdminDb();
    const staffRef = adminDb.doc(`staff/${actorUid}`);
    const activeSessionRef = adminDb.doc(`stores/${storeId}/activeSessions/${sessionId}`);
    const archiveRef = adminDb.doc(`stores/${storeId}/pinArchiveByDay/${dayId}/pins/${pin}`);
    const pinRef = adminDb.doc(`pinRegistry/${pin}`);

    const result = await adminDb.runTransaction(async (tx) => {
      const [staffSnap, activeSnap, archiveSnap, livePinSnap] = await Promise.all([
        tx.get(staffRef),
        tx.get(activeSessionRef),
        tx.get(archiveRef),
        tx.get(pinRef),
      ]);

      const staff = staffSnap.exists ? (staffSnap.data() as any) : null;
      const role = String(staff?.role || "");
      if (!["admin", "manager", "cashier"].includes(role)) {
        throw new Error("You are not allowed to revive PINs.");
      }

      if (!activeSnap.exists) {
        throw new Error("Active session not found.");
      }

      const active = activeSnap.data() as any;
      if ((active?.sessionMode || "") === "alacarte") {
        throw new Error("PINs are only allowed for dine-in unlimited/package sessions.");
      }

      if (livePinSnap.exists && livePinSnap.data()?.status === "active") {
        throw new Error("PIN is already active.");
      }

      if (!archiveSnap.exists) {
        throw new Error("Archived PIN not found.");
      }

      const archived = archiveSnap.data() as any;
      const nowMs = Date.now();
      const expiresAtMs = nowMs + PIN_TTL_MS;

      const oldPin = active?.customerPin ? String(active.customerPin) : null;
      if (oldPin && oldPin !== pin) {
        const oldPinRef = adminDb.doc(`pinRegistry/${oldPin}`);
        const oldPinSnap = await tx.get(oldPinRef);
        if (oldPinSnap.exists) {
          tx.set(
            adminDb.doc(`stores/${storeId}/pinArchiveByDay/${dayId}/pins/${oldPin}`),
            {
              ...oldPinSnap.data(),
              pin: oldPin,
              archivedAt: FieldValue.serverTimestamp(),
              archivedByUid: actorUid,
              archiveReason: "revive_replaced_existing",
              originalStatus: oldPinSnap.data()?.status || "active",
              status: "archived",
            },
            { merge: true }
          );
          tx.update(oldPinRef, {
            status: "archived",
            archivedAtMs: nowMs,
            archivedAt: FieldValue.serverTimestamp(),
            archivedByUid: actorUid,
            archiveReason: "revive_replaced_existing",
          });
        }
      }

      tx.set(pinRef, {
        pin,
        storeId,
        sessionId,
        customerName: archived?.customerName ?? active?.customerName ?? null,
        tableDisplayName: archived?.tableDisplayName ?? active?.tableDisplayName ?? null,
        tableNumber: archived?.tableNumber ?? active?.tableNumber ?? active?.tableDisplayName ?? null,
        status: "active",
        issuedAt: FieldValue.serverTimestamp(),
        issuedByUid: actorUid,
        revivedAt: FieldValue.serverTimestamp(),
        revivedByUid: actorUid,
        sourceArchiveDayId: dayId,
        expiresAtMs,
      });

      tx.set(
        activeSessionRef,
        {
          customerPin: pin,
          customerAccessEnabled: true,
          customerAccessExpiresAtMs: expiresAtMs,
          customerJoinVersion: FieldValue.increment(1),
          customerParticipantActiveCount: 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        archiveRef,
        {
          ...archived,
          revivedAt: FieldValue.serverTimestamp(),
          revivedByUid: actorUid,
          reviveCount: Number(archived?.reviveCount || 0) + 1,
          status: "revived",
        },
        { merge: true }
      );

      return { ok: true, pin, expiresAtMs };
    });

    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[api/pins/revive] failed:", e);
    const message = e?.message || "Failed to revive PIN.";
    const status =
      /Missing bearer token|verifyIdToken/i.test(message) ? 401 :
      /not allowed/i.test(message) ? 403 :
      /required|not found|already active|only allowed/i.test(message) ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
