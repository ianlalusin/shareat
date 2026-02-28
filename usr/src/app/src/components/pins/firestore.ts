
import { db } from "@/lib/firebase/client";
import {
  arrayUnion,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
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
    // --- READ PHASE ---
    const activeSnap = await tx.get(activeSessionRef);
    if (!activeSnap.exists()) throw new Error("Active session not found.");
    const active = activeSnap.data() as any;

    // Find a new unique PIN by reading potential candidates.
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
    if (!reservedPin || !pinRef) {
      throw new Error("Failed to reserve a unique PIN. Try again.");
    }

    // --- WRITE PHASE ---
    // Now that all reads are done, we can start writing.
    
    // Invalidate old pin if present.
    const oldPin = active?.customerPin ? String(active.customerPin) : null;
    if (oldPin) {
      tx.delete(pinRegistryDocRef(oldPin));
    }

    const expiresAtMs = Date.now() + PIN_TTL_MS;

    // Write new pin registry doc.
    tx.set(pinRef, {
      pin: reservedPin,
      storeId,
      sessionId,
      status: "active",
      issuedAt: serverTimestamp(),
      expiresAtMs,
    });

    // Update session projection explicitly.
    tx.set(
      activeSessionRef,
      {
        customerPin: reservedPin,
        customerAccessEnabled: true,
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
    if (!snap.exists()) throw new Error("Active session not found.");
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
