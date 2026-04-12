import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

const DEFAULT_POINTS_PER_PESO = 0.01; // 1 point per ₱100

type WriteLoyaltyEarnArgs = {
  storeId: string;
  sessionId: string;
  phone: string;
  amount: number;
  receiptId?: string;
  staffUid: string;
};

export async function writeLoyaltyEarn({
  storeId,
  sessionId,
  phone,
  amount,
  receiptId,
  staffUid,
}: WriteLoyaltyEarnArgs): Promise<{ ok: boolean; points?: number; error?: string }> {
  if (!phone || amount <= 0) return { ok: false, error: "Invalid amount or phone" };

  const db = getAdminDb();

  try {
    // Read store's loyaltyConfig
    const storeSnap = await db.doc(`stores/${storeId}`).get();
    const loyaltyConfig = storeSnap.exists ? (storeSnap.data()?.loyaltyConfig as any) : null;

    if (loyaltyConfig && loyaltyConfig.isEnabled === false) {
      return { ok: false, error: "Loyalty disabled for this store" };
    }

    const rate = Number(loyaltyConfig?.pointsPerPeso) || DEFAULT_POINTS_PER_PESO;
    const points = Math.floor(amount * rate);
    if (points <= 0) return { ok: false, error: "Amount too low to earn points" };

    const customerRef = db.doc(`customers/${phone}`);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) return { ok: false, error: "Customer not found" };

    const ledgerRef = customerRef.collection("pointsLedger").doc();

    await db.runTransaction(async (tx) => {
      tx.set(ledgerRef, {
        type: "earn",
        points,
        amount,
        storeId,
        sessionId,
        receiptId: receiptId ?? null,
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: staffUid,
      });
      tx.update(customerRef, {
        pointsBalance: FieldValue.increment(points),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    // Stamp link lock on session projections
    const activeRef = db.doc(`stores/${storeId}/activeSessions/${sessionId}`);
    const sessionRef = db.doc(`stores/${storeId}/sessions/${sessionId}`);
    const lockData = { linkedCustomerLockedAt: FieldValue.serverTimestamp() };

    const batch = db.batch();
    const activeSnap = await activeRef.get();
    if (activeSnap.exists) batch.update(activeRef, lockData);
    const sessionSnap = await sessionRef.get();
    if (sessionSnap.exists) batch.update(sessionRef, lockData);
    await batch.commit();

    return { ok: true, points };
  } catch (err: any) {
    console.error("[writeLoyaltyEarn] failed:", err);
    return { ok: false, error: err.message || String(err) };
  }
}
