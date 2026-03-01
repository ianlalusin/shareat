import { db } from "@/lib/firebase/client";
import {
  arrayUnion,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  updateDoc,
} from "firebase/firestore";

const PIN_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

function randomCustomerPin(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function pinRegistryDocRef(pin: string) {
  return doc(db, "pinRegistry", pin);
}

/**
 * Manual PIN issue/refresh for an existing active session projection.
 * - Deletes previous pinRegistry/{oldPin} if present
 * - Reserves unique new pinRegistry/{PIN}
 * - Writes pinRegistry
 * - Updates activeSessions/{sessionId} with explicit fields
 */
export async function issueCustomerPinClient(params: { storeId: string; sessionId: string }) {
  const { storeId, sessionId } = params;

  const activeSessionRef = doc(db, `stores/${storeId}/activeSessions`, sessionId);

  return await runTransaction(db, async (tx) => {
    const activeSnap = await tx.get(activeSessionRef);
    if (!activeSnap.exists()) throw new Error("Active session not found.");

    const active = activeSnap.data() as any;

    // Invalidate old pin if present
    const oldPin = active?.customerPin ? String(active.customerPin) : null;
    if (oldPin) tx.delete(pinRegistryDocRef(oldPin));

    // Reserve unique PIN (read phase)
    let reservedPin: string | null = null;
    let pinRef: DocumentReference | null = null;

    for (let attempt = 0; attempt < 25; attempt++) {
      const candidate = randomCustomerPin();
      const ref = pinRegistryDocRef(candidate);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        reservedPin = candidate;
        pinRef = ref;
        break;
      }
    }
    if (!reservedPin || !pinRef) throw new Error("Failed to reserve a unique PIN. Try again.");

    const expiresAtMs = Date.now() + PIN_TTL_MS;

    // Write pin registry doc
    tx.set(pinRef, {
      pin: reservedPin,
      storeId,
      sessionId,
      status: "active",
      issuedAt: serverTimestamp(),
      expiresAtMs,
    });

    // Update session projection explicitly
    tx.set(
      activeSessionRef,
      {
        customerPin: reservedPin,
        customerAccessEnabled: true, // <-- always present
        customerAccessExpiresAtMs: expiresAtMs,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return { pin: reservedPin, expiresAtMs };
  });
}

export async function disableCustomerAccessClient(params: { storeId: string; sessionId: string }) {
  const { storeId, sessionId } = params;
  const activeSessionRef = doc(db, `stores/${storeId}/activeSessions`, sessionId);

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(activeSessionRef);
    if (!snap.exists()) {
        console.warn(`disableCustomerAccessClient: Active session ${sessionId} not found.`);
        return { ok: false, message: "Active session not found." };
    }
    const data = snap.data() as any;

    const oldPin = data?.customerPin ? String(data.customerPin) : null;
    if (oldPin) tx.delete(pinRegistryDocRef(oldPin));

    tx.set(
      activeSessionRef,
      {
        customerAccessEnabled: false,
        customerPin: null,
        customerAccessExpiresAtMs: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true };
  });
}


/**
 * Disables a PIN in the pinRegistry and attempts to clear the PIN from the
 * corresponding active session projection.
 */
export async function disablePinInRegistry(params: {
  pin: string;
  storeId: string;
  sessionId: string;
}) {
  const { pin, storeId, sessionId } = params;

  const pinRef = pinRegistryDocRef(pin);
  const activeSessionRef = doc(db, `stores/${storeId}/activeSessions`, sessionId);

  return await runTransaction(db, async (tx) => {
    const activeSessionSnap = await tx.get(activeSessionRef);

    // Always disable the pin in the registry
    tx.update(pinRef, {
      status: "disabled",
      updatedAt: serverTimestamp(),
    });

    // If the active session projection still exists, also clear its PIN fields
    if (activeSessionSnap.exists()) {
      tx.set(
        activeSessionRef,
        {
          customerAccessEnabled: false,
          customerPin: null,
          customerAccessExpiresAtMs: null,
        },
        { merge: true }
      );
    }
  });
}
