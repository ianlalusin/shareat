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
    // Read store's loyaltyConfig and name
    const storeSnap = await db.doc(`stores/${storeId}`).get();
    const storeData = storeSnap.exists ? (storeSnap.data() as any) : null;
    const loyaltyConfig = storeData?.loyaltyConfig as any;
    const storeName: string = storeData?.name || storeId;

    if (loyaltyConfig && loyaltyConfig.isEnabled === false) {
      return { ok: false, error: "Loyalty disabled for this store" };
    }

    const rate = Number(loyaltyConfig?.pointsPerPeso) || DEFAULT_POINTS_PER_PESO;
    const points = Math.floor(amount * rate);
    if (points <= 0) return { ok: false, error: "Amount too low to earn points" };

    const customerRef = db.doc(`customers/${phone}`);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) return { ok: false, error: "Customer not found" };

    const customerName = (customerSnap.data() as any)?.name || "";

    // Idempotency: when receiptId is provided, use it as the deterministic
    // ledger doc ID so a retry of the same earn is a no-op.
    const ledgerRef = receiptId
      ? customerRef.collection("pointsLedger").doc(receiptId)
      : customerRef.collection("pointsLedger").doc();
    const logRef = db.collection("loyaltyLogs").doc();
    const statsRef = db.doc("loyaltyStats/global");

    const wasIdempotentNoop = await db.runTransaction(async (tx) => {
      // If this earn has already been recorded (same receiptId), short-circuit.
      if (receiptId) {
        const existing = await tx.get(ledgerRef);
        if (existing.exists) return true;
      }
      tx.set(ledgerRef, {
        type: "earn",
        points,
        amount,
        storeId,
        storeName,
        sessionId,
        receiptId: receiptId ?? null,
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: staffUid,
      });
      tx.update(customerRef, {
        pointsBalance: FieldValue.increment(points),
        visitCount: FieldValue.increment(1),
        [`storeVisits.${storeId}.storeName`]: storeName,
        [`storeVisits.${storeId}.visits`]: FieldValue.increment(1),
        [`storeVisits.${storeId}.pointsEarned`]: FieldValue.increment(points),
        [`storeVisits.${storeId}.lastVisitAtMs`]: Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(logRef, {
        type: "points_earned",
        phone,
        customerName,
        actorUid: staffUid,
        storeId,
        storeName,
        sessionId,
        points,
        amount,
        createdAt: FieldValue.serverTimestamp(),
      });
      // Global aggregate projection — replaces a 500-doc client-side scan
      tx.set(statsRef, {
        totalPointsOutstanding: FieldValue.increment(points),
        totalPointsEarnedEver: FieldValue.increment(points),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return false;
    });

    if (wasIdempotentNoop) {
      // Still stamp lock to guarantee the session can't be re-linked. Safe to re-apply.
    }

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
