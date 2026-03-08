import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { getManilaDayId } from "@/lib/pins/day-id";

export const runtime = "nodejs";

const PIN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function randomCustomerPin(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

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

    if (!storeId || !sessionId) {
      return NextResponse.json({ error: "storeId and sessionId are required." }, { status: 400 });
    }

    const adminDb = getAdminDb();
    const activeSessionRef = adminDb.doc(`stores/${storeId}/activeSessions/${sessionId}`);
    const staffRef = adminDb.doc(`staff/${actorUid}`);

    const result = await adminDb.runTransaction(async (tx) => {
      const [activeSnap, staffSnap] = await Promise.all([
        tx.get(activeSessionRef),
        tx.get(staffRef),
      ]);

      if (!activeSnap.exists) {
        throw new Error("Active session not found.");
      }

      const staff = staffSnap.exists ? (staffSnap.data() as any) : null;
      const role = String(staff?.role || "");
      if (!["admin", "manager", "cashier"].includes(role)) {
        throw new Error("You are not allowed to issue PINs.");
      }

      const active = activeSnap.data() as any;
      if ((active?.sessionMode || "") === "alacarte") {
        throw new Error("PINs are only allowed for dine-in unlimited/package sessions.");
      }

      let reservedPin: string | null = null;
      let pinRef: FirebaseFirestore.DocumentReference | null = null;

      for (let attempt = 0; attempt < 25; attempt++) {
        const candidate = randomCustomerPin();
        const candidateRef = adminDb.doc(`pinRegistry/${candidate}`);
        const candidateSnap = await tx.get(candidateRef);
        if (!candidateSnap.exists) {
          reservedPin = candidate;
          pinRef = candidateRef;
          break;
        }
      }

      if (!reservedPin || !pinRef) {
        throw new Error("Failed to reserve a unique PIN. Try again.");
      }

      const nowMs = Date.now();
      const expiresAtMs = nowMs + PIN_TTL_MS;
      const dayId = getManilaDayId(nowMs);

      const oldPin = active?.customerPin ? String(active.customerPin) : null;
      if (oldPin) {
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
              archiveReason: "reissued",
              replacedByPin: reservedPin,
              originalStatus: oldPinSnap.data()?.status || "active",
              status: "archived",
            },
            { merge: true }
          );
        }
        tx.delete(oldPinRef);
      }

      tx.set(pinRef, {
        pin: reservedPin,
        storeId,
        sessionId,
        customerName: active?.customerName ?? null,
        tableDisplayName: active?.tableDisplayName ?? null,
        tableNumber: active?.tableNumber ?? active?.tableDisplayName ?? null,
        status: "active",
        issuedAt: FieldValue.serverTimestamp(),
        issuedByUid: actorUid,
        expiresAtMs,
      });

      tx.set(
        activeSessionRef,
        {
          customerPin: reservedPin,
          customerAccessEnabled: true,
          customerAccessExpiresAtMs: expiresAtMs,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { pin: reservedPin, expiresAtMs };
    });

    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[api/pins/issue] failed:", e);
    const message = e?.message || "Failed to issue PIN.";
    const status =
      /Missing bearer token|verifyIdToken/i.test(message) ? 401 :
      /not allowed/i.test(message) ? 403 :
      /required|not found|only allowed/i.test(message) ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
