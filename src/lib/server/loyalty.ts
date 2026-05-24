import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { appendLogToProjection } from "@/lib/server/loyaltyLog";

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
    } else {
      // Best-effort projection append — source of truth already committed in tx.
      await appendLogToProjection(
        {
          type: "points_earned",
          phone,
          customerName,
          actorUid: staffUid,
          storeId,
          storeName,
          sessionId,
          points,
          amount,
        },
        logRef.id
      );
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

// ---------------------------------------------------------------------------
// Redemption (claim/use points for a rewards-catalog reward)
// ---------------------------------------------------------------------------

const REDEEM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
function genRedemptionCode(len = 6): string {
  let s = "";
  for (let i = 0; i < len; i++) s += REDEEM_CODE_ALPHABET[Math.floor(Math.random() * REDEEM_CODE_ALPHABET.length)];
  return s;
}

type RedeemArgs = {
  storeId: string;
  sessionId: string;
  phone: string;
  rewardId: string;
  staffUid: string;
};

type RedeemResult = {
  ok: boolean;
  error?: string;
  redemptionId?: string;
  code?: string;
  reward?: { name: string; type: "fixed" | "percent"; value: number; pointsCost: number };
};

/**
 * Cashier-side redemption: debit the member's points for a reward and create
 * an `applied` redemption record linked to the session. The caller then applies
 * the reward as a bill discount. Reverse with reverseLoyaltyRedeem (remove /
 * void / refund).
 */
export async function writeLoyaltyRedeem({ storeId, sessionId, phone, rewardId, staffUid }: RedeemArgs): Promise<RedeemResult> {
  if (!phone || !rewardId) return { ok: false, error: "Missing phone or reward" };
  const db = getAdminDb();

  try {
    const customerRef = db.doc(`customers/${phone}`);
    const rewardRef = db.doc(`loyaltyRewards/${rewardId}`);
    const sessionRef = db.doc(`stores/${storeId}/sessions/${sessionId}`);
    const redemptionRef = db.collection("loyaltyRedemptions").doc();
    const ledgerRef = customerRef.collection("pointsLedger").doc();
    const logRef = db.collection("loyaltyLogs").doc();
    const statsRef = db.doc("loyaltyStats/global");
    const now = Date.now();
    const code = genRedemptionCode();

    const result = await db.runTransaction(async (tx) => {
      const [cSnap, rewardSnap, sessSnap] = await Promise.all([tx.get(customerRef), tx.get(rewardRef), tx.get(sessionRef)]);
      if (!cSnap.exists) throw new Error("Customer not found");
      if (!rewardSnap.exists) throw new Error("Reward not found");
      const c = cSnap.data() as any;
      const reward = rewardSnap.data() as any;
      if (reward.isActive === false) throw new Error("Reward is not available");

      const pointsCost = Math.floor(Number(reward.pointsCost) || 0);
      const value = Number(reward.value) || 0;
      const type = reward.type === "percent" ? "percent" : "fixed";
      if (pointsCost <= 0 || value <= 0) throw new Error("Invalid reward configuration");

      const balance = Number(c.pointsBalance || 0);
      if (balance < pointsCost) throw new Error("Insufficient points");
      const name = c.name || "";

      // Per-visit limit: how many times this member already claimed THIS reward
      // on THIS session.
      const maxPerVisit = Math.max(1, Math.floor(Number(reward.maxPerVisit) || 1));
      const existing = sessSnap.exists ? (sessSnap.data() as any).loyaltyRedemptions : null;
      const existingArr: Array<{ rewardId?: string; phone?: string }> = Array.isArray(existing) ? existing : [];
      const sameRewardCount = existingArr.filter((e) => e.rewardId === rewardId && e.phone === phone).length;
      if (sameRewardCount >= maxPerVisit) throw new Error("Already claimed this reward this visit");

      // Per-store claim cap.
      const maxClaimsPerStore = Number(reward.maxClaimsPerStore) || 0;
      if (maxClaimsPerStore > 0) {
        const usedAtStore = Number((reward.claimsByStore ?? {})[storeId] ?? 0);
        if (usedAtStore >= maxClaimsPerStore) throw new Error("Reward claim limit reached at this store");
      }

      tx.update(customerRef, { pointsBalance: FieldValue.increment(-pointsCost), updatedAt: FieldValue.serverTimestamp() });
      tx.set(ledgerRef, {
        type: "redeem", points: -pointsCost, amount: 0, storeId, storeName: "", sessionId,
        rewardId, rewardName: reward.name, redemptionId: redemptionRef.id,
        createdAt: FieldValue.serverTimestamp(), createdByUid: staffUid,
      });
      tx.set(redemptionRef, {
        id: redemptionRef.id, code, phone, rewardId, rewardName: reward.name,
        pointsCost, type, value,
        status: "applied", source: "pos",
        createdAt: FieldValue.serverTimestamp(), createdAtClientMs: now, expiresAtMs: now,
        appliedStoreId: storeId, appliedSessionId: sessionId, appliedReceiptId: null,
        appliedByUid: staffUid, appliedAtMs: now,
      });
      tx.set(logRef, {
        type: "points_redeemed", phone, customerName: name, actorUid: staffUid,
        storeId, sessionId, points: pointsCost, rewardName: reward.name,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(statsRef, {
        totalPointsOutstanding: FieldValue.increment(-pointsCost),
        totalPointsRedeemedEver: FieldValue.increment(pointsCost),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      // Bump the per-store claim counter on the reward.
      tx.set(rewardRef, { claimsByStore: { [storeId]: FieldValue.increment(1) }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      // Append the redemption onto the session (array) so bill totals + payment
      // reflect it. Bump billingRevision so an in-flight payment re-checks.
      const newEntry = { redemptionId: redemptionRef.id, rewardId, rewardName: reward.name, type, value, pointsCost, phone };
      tx.set(sessionRef, {
        loyaltyRedemptions: [...existingArr, newEntry],
        billingRevision: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { name, rewardName: reward.name, type, value, pointsCost };
    });
    const customerName = result.name;

    try {
      await appendLogToProjection(
        { type: "points_redeemed", phone, customerName, actorUid: staffUid, storeId, sessionId, points: result.pointsCost, rewardName: result.rewardName } as any,
        logRef.id,
      );
    } catch {}

    return { ok: true, redemptionId: redemptionRef.id, code, reward: { name: result.rewardName, type: result.type as "fixed" | "percent", value: result.value, pointsCost: result.pointsCost } };
  } catch (err: any) {
    const msg = err.message || String(err);
    console.error("[writeLoyaltyRedeem] failed:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Reverse a redemption — credit the points back and mark the record cancelled.
 * Idempotent: a redemption already cancelled/expired is a no-op. Used when a
 * cashier removes a reward, or a session that used it is voided/refunded, or a
 * Hub voucher expires unused.
 */
export async function reverseLoyaltyRedeem(redemptionId: string, actorUid: string, reason: string): Promise<{ ok: boolean; error?: string; refunded?: number }> {
  if (!redemptionId) return { ok: false, error: "Missing redemptionId" };
  const db = getAdminDb();
  const redRef = db.doc(`loyaltyRedemptions/${redemptionId}`);
  const statsRef = db.doc("loyaltyStats/global");

  try {
    const refunded = await db.runTransaction(async (tx) => {
      // --- reads (all before writes) ---
      const rSnap = await tx.get(redRef);
      if (!rSnap.exists) throw new Error("Redemption not found");
      const r = rSnap.data() as any;
      if (r.status === "cancelled" || r.status === "expired") return 0; // already reversed

      const hasSession = !!(r.appliedStoreId && r.appliedSessionId);
      const sessionRef = hasSession ? db.doc(`stores/${r.appliedStoreId}/sessions/${r.appliedSessionId}`) : null;
      const sessSnap = sessionRef ? await tx.get(sessionRef) : null;

      // --- writes ---
      const pointsCost = Math.floor(Number(r.pointsCost) || 0);
      const customerRef = db.doc(`customers/${r.phone}`);
      const ledgerRef = customerRef.collection("pointsLedger").doc();

      tx.update(customerRef, { pointsBalance: FieldValue.increment(pointsCost), updatedAt: FieldValue.serverTimestamp() });
      tx.set(ledgerRef, {
        type: "redeem_refund", points: pointsCost, amount: 0, storeId: r.appliedStoreId ?? "", storeName: "",
        sessionId: r.appliedSessionId ?? "", redemptionId, rewardId: r.rewardId, rewardName: r.rewardName,
        reason, createdAt: FieldValue.serverTimestamp(), createdByUid: actorUid,
      });
      tx.update(redRef, { status: reason === "expired" ? "expired" : "cancelled", refundedAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() });
      tx.set(statsRef, { totalPointsOutstanding: FieldValue.increment(pointsCost), updatedAt: FieldValue.serverTimestamp() }, { merge: true });

      // Free up the per-store claim counter.
      if (r.rewardId && r.appliedStoreId) {
        tx.set(db.doc(`loyaltyRewards/${r.rewardId}`), { claimsByStore: { [r.appliedStoreId]: FieldValue.increment(-1) }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }

      // Drop this redemption from its session so the bill discount goes away.
      if (sessionRef && sessSnap?.exists) {
        const existing = ((sessSnap.data() as any).loyaltyRedemptions ?? []) as Array<{ redemptionId?: string }>;
        const next = existing.filter((e) => e.redemptionId !== redemptionId);
        tx.set(sessionRef, {
          loyaltyRedemptions: next,
          billingRevision: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return pointsCost;
    });

    return { ok: true, refunded };
  } catch (err: any) {
    const msg = err.message || String(err);
    console.error("[reverseLoyaltyRedeem] failed:", msg);
    return { ok: false, error: msg };
  }
}
