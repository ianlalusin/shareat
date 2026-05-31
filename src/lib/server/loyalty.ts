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
        // POS-created redemptions debit points right here, so they are already
        // spent and hold nothing — finalize's !pointsSpent guard skips them.
        pointsSpent: true, pointsSpentAtMs: now, reservedPoints: 0,
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

      // Shared writes used by both the reuse and refund paths below.
      const releaseStoreCounter = () => {
        // Free up the per-store claim counter the apply bumped.
        if (r.rewardId && r.appliedStoreId) {
          tx.set(db.doc(`loyaltyRewards/${r.rewardId}`), { claimsByStore: { [r.appliedStoreId]: FieldValue.increment(-1) }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      };
      const detachFromSession = () => {
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
      };

      // A Hub voucher that the cashier removes BEFORE the session is paid was
      // never truly consumed: its points were debited in the Hub (not here) and
      // no receipt exists yet. Returning it to "active" lets the same code be
      // re-entered — fixing the "accidentally deleted, now permanently blocked"
      // bug. The voucher's used/blocked state is only committed once the session
      // is paid (see finalizeLoyaltyVouchers), which stamps appliedReceiptId.
      const isReusableVoucherRemoval = reason === "removed" && r.source === "hub" && !r.appliedReceiptId;
      if (isReusableVoucherRemoval) {
        tx.update(redRef, {
          status: "active",
          appliedStoreId: null,
          appliedSessionId: null,
          appliedByUid: null,
          appliedAtMs: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
        releaseStoreCounter();
        detachFromSession();
        return 0; // nothing refunded — the voucher itself is preserved for reuse
      }

      // --- refund / hold-release path: POS redemptions, voids/refunds, expiries ---
      // Whether points were actually spent is the decider — NOT reason/source.
      // Spent (POS redemption, or a Hub voucher already used in a paid bill) ->
      // refund. Only held (pending Hub voucher, never paid) -> release the hold,
      // no refund ledger and no outstanding change (nothing was ever spent).
      const pointsCost = Math.floor(Number(r.pointsCost) || 0);
      const reservedPoints = Math.floor(Number(r.reservedPoints) || 0);
      const customerRef = db.doc(`customers/${r.phone}`);
      const terminalStatus = reason === "expired" ? "expired" : "cancelled";

      if (r.pointsSpent) {
        const ledgerRef = customerRef.collection("pointsLedger").doc();
        tx.update(customerRef, { pointsBalance: FieldValue.increment(pointsCost), updatedAt: FieldValue.serverTimestamp() });
        tx.set(ledgerRef, {
          type: "redeem_refund", points: pointsCost, amount: 0, storeId: r.appliedStoreId ?? "", storeName: "",
          sessionId: r.appliedSessionId ?? "", redemptionId, rewardId: r.rewardId, rewardName: r.rewardName,
          reason, createdAt: FieldValue.serverTimestamp(), createdByUid: actorUid,
        });
        tx.set(statsRef, { totalPointsOutstanding: FieldValue.increment(pointsCost), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      } else if (reservedPoints > 0) {
        tx.update(customerRef, { pointsReserved: FieldValue.increment(-reservedPoints), updatedAt: FieldValue.serverTimestamp() });
      }
      tx.update(redRef, { status: terminalStatus, refundedAtMs: Date.now(), reservedPoints: 0, updatedAt: FieldValue.serverTimestamp() });

      releaseStoreCounter();
      detachFromSession();
      return r.pointsSpent ? pointsCost : 0;
    });

    return { ok: true, refunded };
  } catch (err: any) {
    const msg = err.message || String(err);
    console.error("[reverseLoyaltyRedeem] failed:", msg);
    return { ok: false, error: msg };
  }
}

type ApplyVoucherArgs = { storeId: string; sessionId: string; code: string; staffUid: string };

/**
 * Apply a Hub-created voucher (by code) to a session. Points were already
 * debited when the voucher was created in the Hub; here we just validate it,
 * enforce the per-visit + per-store limits, bump the per-store counter, and
 * attach it to the session as a bill discount.
 */
export async function applyLoyaltyVoucher({ storeId, sessionId, code, staffUid }: ApplyVoucherArgs): Promise<RedeemResult> {
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode) return { ok: false, error: "Missing code" };
  const db = getAdminDb();

  try {
    // Locate the voucher by code (query outside the transaction).
    const q = await db.collection("loyaltyRedemptions").where("code", "==", cleanCode).limit(5).get();
    const voucherDoc = q.docs.find((d) => (d.data() as any).status === "active");
    if (!voucherDoc) return { ok: false, error: "Voucher not found or already used" };

    const redemptionRef = voucherDoc.ref;
    const sessionRef = db.doc(`stores/${storeId}/sessions/${sessionId}`);

    const result = await db.runTransaction(async (tx) => {
      const vSnap = await tx.get(redemptionRef);
      if (!vSnap.exists) throw new Error("Voucher not found");
      const v = vSnap.data() as any;
      if (v.status !== "active") throw new Error("Voucher already used or cancelled");
      if (typeof v.expiresAtMs === "number" && v.expiresAtMs < Date.now()) throw new Error("Voucher has expired");

      const rewardRef = db.doc(`loyaltyRewards/${v.rewardId}`);
      const [rewardSnap, sessSnap] = await Promise.all([tx.get(rewardRef), tx.get(sessionRef)]);
      const reward = rewardSnap.exists ? (rewardSnap.data() as any) : null;

      // Per-visit limit.
      const maxPerVisit = Math.max(1, Math.floor(Number(reward?.maxPerVisit) || 1));
      const existing = sessSnap.exists ? (sessSnap.data() as any).loyaltyRedemptions : null;
      const existingArr: Array<{ rewardId?: string; phone?: string }> = Array.isArray(existing) ? existing : [];
      const sameRewardCount = existingArr.filter((e) => e.rewardId === v.rewardId && e.phone === v.phone).length;
      if (sameRewardCount >= maxPerVisit) throw new Error("Already claimed this reward this visit");

      // Per-store cap.
      const maxClaimsPerStore = Number(reward?.maxClaimsPerStore) || 0;
      if (maxClaimsPerStore > 0) {
        const usedAtStore = Number((reward?.claimsByStore ?? {})[storeId] ?? 0);
        if (usedAtStore >= maxClaimsPerStore) throw new Error("Reward claim limit reached at this store");
      }

      // Mark the voucher applied + bump the per-store counter + attach to the session.
      const nowMs = Date.now();
      tx.update(redemptionRef, {
        status: "applied", appliedStoreId: storeId, appliedSessionId: sessionId,
        appliedByUid: staffUid, appliedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp(),
      });
      if (v.rewardId) {
        tx.set(db.doc(`loyaltyRewards/${v.rewardId}`), { claimsByStore: { [storeId]: FieldValue.increment(1) }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      const newEntry = { redemptionId: redemptionRef.id, rewardId: v.rewardId, rewardName: v.rewardName, type: v.type, value: v.value, pointsCost: v.pointsCost, phone: v.phone };
      tx.set(sessionRef, {
        loyaltyRedemptions: [...existingArr, newEntry],
        billingRevision: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { rewardName: v.rewardName, type: v.type, value: v.value, pointsCost: v.pointsCost };
    });

    return { ok: true, redemptionId: redemptionRef.id, code: cleanCode, reward: { name: result.rewardName, type: result.type as "fixed" | "percent", value: result.value, pointsCost: result.pointsCost } };
  } catch (err: any) {
    const msg = err.message || String(err);
    console.error("[applyLoyaltyVoucher] failed:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Commit the used/blocked state of every loyalty redemption attached to a
 * session once that session has been PAID. Until this runs an applied voucher
 * can be removed and returned to "active" (reusable); stamping appliedReceiptId
 * here is the point of no return — the voucher is now permanently consumed by a
 * real receipt and can never be re-applied. Idempotent and best-effort: a
 * redemption already stamped is skipped, so retries / replays are safe.
 */
export async function finalizeLoyaltyVouchers({
  storeId,
  sessionId,
  receiptId,
}: {
  storeId: string;
  sessionId: string;
  receiptId: string;
}): Promise<{ ok: boolean; finalized: number; error?: string }> {
  if (!storeId || !sessionId || !receiptId) return { ok: false, finalized: 0, error: "Missing required fields" };
  const db = getAdminDb();

  try {
    const sessSnap = await db.doc(`stores/${storeId}/sessions/${sessionId}`).get();
    if (!sessSnap.exists) return { ok: true, finalized: 0 };
    const arr = (sessSnap.data() as any)?.loyaltyRedemptions;
    const ids: string[] = Array.isArray(arr)
      ? arr.map((e: any) => e?.redemptionId).filter((x: any): x is string => typeof x === "string" && !!x)
      : [];
    if (ids.length === 0) return { ok: true, finalized: 0 };

    const nowMs = Date.now();
    let finalized = 0;
    for (const id of ids) {
      const ref = db.doc(`loyaltyRedemptions/${id}`);
      const done = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const r = snap.data() as any;
        if (r.appliedReceiptId) return false; // already finalized — idempotent no-op

        // The session is now PAID, so this is where a Hub voucher's points are
        // actually spent (claim only placed a hold). Skip docs already spent
        // (POS-created, or pointsSpent already true) via the guard below.
        const pointsCost = Math.floor(Number(r.pointsCost) || 0);
        const reservedPoints = Math.floor(Number(r.reservedPoints) || 0);
        const needsDebit = !r.pointsSpent && pointsCost > 0 && !!r.phone;

        if (needsDebit) {
          const customerRef = db.doc(`customers/${r.phone}`);
          tx.update(customerRef, {
            pointsBalance: FieldValue.increment(-pointsCost),
            pointsReserved: FieldValue.increment(-reservedPoints),
            updatedAt: FieldValue.serverTimestamp(),
          });
          // Deterministic ledger id so a torn retry of the fire-and-forget
          // finalize can never write the same redeem twice.
          const ledgerRef = customerRef.collection("pointsLedger").doc(`${receiptId}_${id}`);
          tx.set(ledgerRef, {
            type: "redeem", points: -pointsCost, amount: 0,
            storeId, storeName: "", sessionId, receiptId,
            rewardId: r.rewardId ?? null, rewardName: r.rewardName ?? "", redemptionId: id,
            createdAt: FieldValue.serverTimestamp(), createdByUid: r.appliedByUid ?? null,
          });
          tx.set(db.doc("loyaltyStats/global"), {
            totalPointsOutstanding: FieldValue.increment(-pointsCost),
            totalPointsRedeemedEver: FieldValue.increment(pointsCost),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        tx.update(ref, {
          status: "applied",
          appliedStoreId: storeId,
          appliedSessionId: sessionId,
          appliedReceiptId: receiptId,
          appliedAtMs: typeof r.appliedAtMs === "number" ? r.appliedAtMs : nowMs,
          lockedAtMs: nowMs,
          pointsSpent: true,
          pointsSpentAtMs: needsDebit ? nowMs : (typeof r.pointsSpentAtMs === "number" ? r.pointsSpentAtMs : nowMs),
          reservedPoints: 0,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (done) finalized++;
    }
    return { ok: true, finalized };
  } catch (err: any) {
    const msg = err.message || String(err);
    console.error("[finalizeLoyaltyVouchers] failed:", msg);
    return { ok: false, finalized: 0, error: msg };
  }
}
