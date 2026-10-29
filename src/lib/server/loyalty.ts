import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { appendLogToProjection } from "@/lib/server/loyaltyLog";
import { isRewardOfferedAtStore } from "@/lib/loyaltyRewardScope";
import { isCashierLinked } from "@/lib/loyalty/session-link";
import { normalizePhone } from "@/lib/phone";

const DEFAULT_POINTS_PER_PESO = 0.01; // 1 point per ₱100

type WriteLoyaltyEarnArgs = {
  storeId: string;
  receiptId: string;
  staffUid: string;
  /** Optional cross-checks only. The receipt and its session are authoritative. */
  sessionId?: string;
  phone?: string;
};

/** Thrown for earn requests that are refused; carries a suggested HTTP status. */
export class LoyaltyEarnRejected extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Thrown for reversals that are refused; carries a suggested HTTP status. */
class LoyaltyReverseRejected extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

class LoyaltyFinalizeRejected extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Global, store-namespaced idempotency marker: one earn per store+receipt. */
export function earnMarkerId(storeId: string, receiptId: string): string {
  return `${storeId}__${receiptId}`;
}

function customerDocId(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return normalizePhone(s) || s;
}

/**
 * Award points for a PAID receipt. Everything is derived from canonical
 * records, never from the request body: the receipt (must exist, be final, not
 * voided, not a refund) gives the amount and session; the session gives the
 * linked card. One earn per store+receipt (global marker), so retries/replays
 * are no-ops.
 */
export async function writeLoyaltyEarn({
  storeId,
  receiptId,
  staffUid,
  sessionId: claimedSessionId,
  phone: claimedPhone,
}: WriteLoyaltyEarnArgs): Promise<{ ok: boolean; points?: number; error?: string; status?: number; duplicate?: boolean }> {
  if (!storeId || !receiptId) return { ok: false, error: "Missing store or receipt", status: 400 };

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

    const rawRate = loyaltyConfig?.pointsPerPeso;
    const rate = rawRate === undefined || rawRate === null ? DEFAULT_POINTS_PER_PESO : Number(rawRate);
    if (!Number.isFinite(rate) || rate <= 0) return { ok: false, error: "Invalid loyalty rate for this store", status: 409 };

    const receiptRef = db.doc(`stores/${storeId}/receipts/${receiptId}`);
    const markerRef = db.doc(`loyaltyEarnReceipts/${earnMarkerId(storeId, receiptId)}`);
    const logRef = db.collection("loyaltyLogs").doc();
    const statsRef = db.doc("loyaltyStats/global");

    const txResult = await db.runTransaction(async (tx) => {
      const [markerSnap, receiptSnap] = await Promise.all([tx.get(markerRef), tx.get(receiptRef)]);
      if (markerSnap.exists) return { duplicate: true as const, points: Number((markerSnap.data() as any)?.points) || 0 };

      if (!receiptSnap.exists) throw new LoyaltyEarnRejected("Receipt not found", 404);
      const receipt = receiptSnap.data() as any;
      if (receipt.status !== "final") throw new LoyaltyEarnRejected("Receipt is not final", 409);
      if (receipt.isRefund === true || receipt.parentReceiptId) throw new LoyaltyEarnRejected("Refund receipts do not earn points", 409);
      const sessionId = String(receipt.sessionId || "");
      if (!sessionId) throw new LoyaltyEarnRejected("Receipt has no session", 409);
      if (claimedSessionId && claimedSessionId !== sessionId) throw new LoyaltyEarnRejected("Receipt does not belong to this session", 409);
      const amount = Number(receipt.total);
      if (!Number.isFinite(amount) || amount <= 0) throw new LoyaltyEarnRejected("Receipt total is not eligible", 409);

      const sessionRef = db.doc(`stores/${storeId}/sessions/${sessionId}`);
      const activeRef = db.doc(`stores/${storeId}/activeSessions/${sessionId}`);
      const [sessionSnap, activeSnap] = await Promise.all([tx.get(sessionRef), tx.get(activeRef)]);
      const sessionData = sessionSnap.exists ? (sessionSnap.data() as any) : null;
      const activeData = activeSnap.exists ? (activeSnap.data() as any) : null;
      // Billout usually deletes the activeSessions projection; the sessions doc survives.
      const linkedRaw = sessionData?.linkedCustomerPhone || activeData?.linkedCustomerPhone || "";
      if (!linkedRaw) throw new LoyaltyEarnRejected("No card linked to this sale", 409);
      const phone = customerDocId(linkedRaw);
      if (claimedPhone && customerDocId(claimedPhone) !== phone) {
        throw new LoyaltyEarnRejected("Card does not match the card linked to this sale", 409);
      }
      // Cashier-linked earns are stamped so the presence resolver can ignore
      // them (see loyaltyPresence.grantsPresence).
      const viaCashierLink = isCashierLinked(sessionData) || isCashierLinked(activeData);

      const points = Math.floor(amount * rate);
      if (points <= 0) throw new LoyaltyEarnRejected("Amount too low to earn points", 400);

      const customerRef = db.doc(`customers/${phone}`);
      // Pre-hardening earns used the receipt id as the ledger id; honour them.
      const legacyLedgerRef = customerRef.collection("pointsLedger").doc(receiptId);
      const [customerSnap, legacySnap] = await Promise.all([tx.get(customerRef), tx.get(legacyLedgerRef)]);
      if (!customerSnap.exists) throw new LoyaltyEarnRejected("Customer not found", 404);
      if (legacySnap.exists && (legacySnap.data() as any)?.type === "earn") {
        tx.set(markerRef, { storeId, receiptId, sessionId, points: Number((legacySnap.data() as any)?.points) || 0, ledgerId: receiptId, createdAt: FieldValue.serverTimestamp() });
        return { duplicate: true as const, points: Number((legacySnap.data() as any)?.points) || 0 };
      }
      const customerName = (customerSnap.data() as any)?.name || "";
      const ledgerId = `earn_${earnMarkerId(storeId, receiptId)}`;
      const ledgerRef = customerRef.collection("pointsLedger").doc(ledgerId);

      tx.set(markerRef, { storeId, receiptId, sessionId, points, ledgerId, createdAt: FieldValue.serverTimestamp(), createdByUid: staffUid });
      tx.set(ledgerRef, {
        type: "earn",
        points,
        amount,
        storeId,
        storeName,
        sessionId,
        receiptId,
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
        receiptId,
        points,
        amount,
        ...(viaCashierLink ? { viaCashierLink: true } : {}),
        createdAt: FieldValue.serverTimestamp(),
      });
      // Global aggregate projection — replaces a 500-doc client-side scan
      tx.set(statsRef, {
        totalPointsOutstanding: FieldValue.increment(points),
        totalPointsEarnedEver: FieldValue.increment(points),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      // Lock the card link so the session can't be re-linked after earning.
      const lockData = { linkedCustomerLockedAt: FieldValue.serverTimestamp() };
      if (sessionSnap.exists) tx.update(sessionRef, lockData);
      if (activeSnap.exists) tx.update(activeRef, lockData);
      return { duplicate: false as const, points, phone, customerName, sessionId, amount, viaCashierLink };
    });

    if (txResult.duplicate) return { ok: true, points: txResult.points, duplicate: true };

    // Best-effort projection append — source of truth already committed in tx.
    try {
      await appendLogToProjection(
        {
          type: "points_earned",
          phone: txResult.phone,
          customerName: txResult.customerName,
          actorUid: staffUid,
          storeId,
          storeName,
          sessionId: txResult.sessionId,
          points: txResult.points,
          amount: txResult.amount,
          viaCashierLink: txResult.viaCashierLink,
        },
        logRef.id
      );
    } catch (e) {
      console.warn("[writeLoyaltyEarn] projection append failed (non-fatal):", e);
    }

    return { ok: true, points: txResult.points };
  } catch (err: any) {
    if (err instanceof LoyaltyEarnRejected) return { ok: false, error: err.message, status: err.status };
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
    // Codes are looked up by value (applyLoyaltyVoucher), so re-roll on the rare
    // chance of a collision with an existing voucher. Done before the tx because
    // queries aren't allowed inside a transaction.
    let code = genRedemptionCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await db.collection("loyaltyRedemptions").where("code", "==", code).limit(1).get();
      if (clash.empty) break;
      code = genRedemptionCode();
    }

    const result = await db.runTransaction(async (tx) => {
      const [cSnap, rewardSnap, sessSnap] = await Promise.all([tx.get(customerRef), tx.get(rewardRef), tx.get(sessionRef)]);
      if (!cSnap.exists) throw new Error("Customer not found");
      if (!rewardSnap.exists) throw new Error("Reward not found");
      const c = cSnap.data() as any;
      const reward = rewardSnap.data() as any;
      if (reward.isActive === false) throw new Error("Reward is not available");
      // Per-store availability. Claims only — an already-issued voucher is
      // honoured wherever it is presented, since the member has already paid
      // the points for it.
      if (!isRewardOfferedAtStore(reward, storeId)) throw new Error("This reward is not offered at this store");

      const pointsCost = Math.floor(Number(reward.pointsCost) || 0);
      const value = Number(reward.value) || 0;
      const type = reward.type === "percent" ? "percent" : "fixed";
      if (pointsCost <= 0 || value <= 0) throw new Error("Invalid reward configuration");

      // Spendable = balance minus points already held by unredeemed Hub
      // vouchers (CUSTOMER sharelebrator/redeem places those holds). Spending
      // held points would let finalize of the held voucher go negative.
      const balance = Number(c.pointsBalance ?? 0);
      const reserved = Number(c.pointsReserved ?? 0);
      if (!Number.isFinite(balance) || !Number.isFinite(reserved) || reserved < 0) throw new Error("Invalid points balance");
      if (balance - reserved < pointsCost) throw new Error("Insufficient points");
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
/** Reversals allowed only while the bill is still unpaid. */
export const PRE_PAYMENT_REVERSAL_REASONS = ["removed", "void", "expired"] as const;
/** Reversals of a PAID bill; each needs a committed void/refund receipt. */
export const PAID_REVERSAL_REASONS = ["receipt_void", "refund"] as const;

export async function reverseLoyaltyRedeem(
  redemptionId: string,
  actorUid: string,
  reason: string,
  opts?: {
    authorize?: (appliedStoreId: string | null) => Promise<void> | void;
    /** Required for reason "refund": the refund receipt tied to the original sale. */
    refundReceiptId?: string;
  }
): Promise<{ ok: boolean; error?: string; refunded?: number; status?: number }> {
  if (!redemptionId) return { ok: false, error: "Missing redemptionId" };
  const isPrePayment = (PRE_PAYMENT_REVERSAL_REASONS as readonly string[]).includes(reason);
  const isPaidReversal = (PAID_REVERSAL_REASONS as readonly string[]).includes(reason);
  if (!isPrePayment && !isPaidReversal) return { ok: false, error: "Invalid reversal reason", status: 400 };
  if (reason === "refund" && !opts?.refundReceiptId) return { ok: false, error: "Refund receipt required", status: 400 };
  const db = getAdminDb();
  const redRef = db.doc(`loyaltyRedemptions/${redemptionId}`);
  const statsRef = db.doc("loyaltyStats/global");

  try {
    // Authorize the caller against the redemption's own store BEFORE mutating
    // anything. Done once here (not inside the tx) so a transaction retry does
    // not re-run the staff lookup. The tx re-checks the store did not change.
    let authorizedStoreId: string | null | undefined;
    if (opts?.authorize) {
      const preSnap = await redRef.get();
      const preStoreId: string | null = preSnap.exists ? ((preSnap.data() as any)?.appliedStoreId ?? null) : null;
      authorizedStoreId = preStoreId;
      await opts.authorize(preStoreId);
    }

    const refunded = await db.runTransaction(async (tx) => {
      // --- reads (all before writes) ---
      const rSnap = await tx.get(redRef);
      if (!rSnap.exists) throw new LoyaltyReverseRejected("Redemption not found", 404);
      const r = rSnap.data() as any;
      if (r.status === "cancelled" || r.status === "expired") return 0; // already reversed
      if (authorizedStoreId !== undefined && (r.appliedStoreId ?? null) !== authorizedStoreId) {
        throw new LoyaltyReverseRejected("Redemption changed store; retry", 409);
      }

      const hasSession = !!(r.appliedStoreId && r.appliedSessionId);
      const sessionRef = hasSession ? db.doc(`stores/${r.appliedStoreId}/sessions/${r.appliedSessionId}`) : null;
      const sessSnap = sessionRef ? await tx.get(sessionRef) : null;
      const sess = sessSnap?.exists ? (sessSnap.data() as any) : null;
      const sessionPaid = !!sess && (sess.isPaid === true || sess.status === "closed");

      if (isPrePayment) {
        // Removing / voiding a redemption returns spent points or frees the
        // voucher, so it is only legal while the bill is unpaid. Once paid it
        // must go through a receipt void / refund (below).
        if (r.appliedReceiptId || sessionPaid) {
          throw new LoyaltyReverseRejected("This reward is on a paid bill; reverse it by voiding or refunding the receipt", 409);
        }
      } else {
        // Paid reversal: the original sale's receipt must exist for this exact
        // store/session, and a committed void (or a refund receipt pointing at
        // it) must exist.
        if (!hasSession) throw new LoyaltyReverseRejected("Redemption is not on a bill", 409);
        const originalReceiptId = String(r.appliedReceiptId || r.appliedSessionId);
        const origSnap = await tx.get(db.doc(`stores/${r.appliedStoreId}/receipts/${originalReceiptId}`));
        const orig = origSnap.exists ? (origSnap.data() as any) : null;
        if (!orig || String(orig.sessionId || "") !== String(r.appliedSessionId)) {
          throw new LoyaltyReverseRejected("Original receipt not found", 409);
        }
        if (reason === "receipt_void") {
          if (orig.status !== "voided") throw new LoyaltyReverseRejected("Original receipt is not voided", 409);
        } else {
          const refundSnap = await tx.get(db.doc(`stores/${r.appliedStoreId}/receipts/${opts!.refundReceiptId}`));
          const refund = refundSnap.exists ? (refundSnap.data() as any) : null;
          if (!refund || refund.isRefund !== true || refund.status === "voided" || String(refund.parentReceiptId || "") !== originalReceiptId) {
            throw new LoyaltyReverseRejected("Refund receipt does not match the original sale", 409);
          }
        }
      }

      // Shared writes used by both the reuse and refund paths below.
      const releaseStoreCounter = () => {
        // Free up the per-store claim counter the apply bumped.
        if (r.rewardId && r.appliedStoreId) {
          tx.set(db.doc(`loyaltyRewards/${r.rewardId}`), { claimsByStore: { [r.appliedStoreId]: FieldValue.increment(-1) }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      };
      const detachFromSession = () => {
        // Drop this redemption from its session so the bill discount goes away.
        // A paid bill's session keeps its record (the receipt is history).
        if (sessionRef && sess && !sessionPaid) {
          const existing = (sess.loyaltyRedemptions ?? []) as Array<{ redemptionId?: string }>;
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
        // Deterministic: one refund per redemption, even across retries.
        const ledgerRef = customerRef.collection("pointsLedger").doc(`redeem_refund_${redemptionId}`);
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
    if (err instanceof LoyaltyReverseRejected) return { ok: false, error: msg, status: err.status };
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
 * Commit the used/blocked state of every loyalty redemption on a PAID receipt.
 * Until this runs an applied voucher can be removed (pre-payment only);
 * stamping appliedReceiptId here is the point of no return. Idempotent: a
 * redemption already stamped with this receipt is skipped.
 *
 * Each voucher is finalized in its own transaction that re-reads the receipt,
 * the session, the redemption and the customer. A voucher is only finalized if
 * it is in the receipt's settled snapshot AND still on the session, is
 * `applied` to this exact store+session, and (for a held Hub voucher) the
 * customer still holds enough points. Invalid vouchers are skipped, not thrown.
 *
 * Returns ok:false (so callers retry and never mark the work done) when the
 * receipt or session is missing or the receipt is not a paid, final sale.
 */
export async function finalizeLoyaltyVouchers({
  storeId,
  sessionId,
  receiptId,
}: {
  storeId: string;
  sessionId: string;
  receiptId: string;
}): Promise<{ ok: boolean; finalized: number; skipped?: string[]; error?: string; status?: number }> {
  if (!storeId || !sessionId || !receiptId) return { ok: false, finalized: 0, error: "Missing required fields", status: 400 };
  const db = getAdminDb();
  const sessionRef = db.doc(`stores/${storeId}/sessions/${sessionId}`);
  const receiptRef = db.doc(`stores/${storeId}/receipts/${receiptId}`);

  // Validates the paid receipt + session; throws LoyaltyFinalizeRejected otherwise.
  const checkPaid = (receiptSnap: any, sessSnap: any) => {
    if (!receiptSnap.exists) throw new LoyaltyFinalizeRejected("Receipt not found", 404);
    const receipt = receiptSnap.data() as any;
    if (receipt.status !== "final" || receipt.isRefund === true || receipt.parentReceiptId) {
      throw new LoyaltyFinalizeRejected("Receipt is not a final sale", 409);
    }
    if (String(receipt.sessionId || "") !== sessionId) throw new LoyaltyFinalizeRejected("Receipt does not belong to this session", 409);
    if (!sessSnap.exists) throw new LoyaltyFinalizeRejected("Session not found", 404);
    const sess = sessSnap.data() as any;
    if (!(sess.isPaid === true || sess.status === "closed")) throw new LoyaltyFinalizeRejected("Session is not paid", 409);
    const ids = (arr: unknown): Set<string> =>
      new Set(Array.isArray(arr) ? arr.map((e: any) => e?.redemptionId).filter((x: any): x is string => typeof x === "string" && !!x) : []);
    return { receiptIds: ids(receipt.loyaltyRedemptions), sessionIds: ids(sess.loyaltyRedemptions) };
  };

  try {
    // Candidate list from the receipt snapshot (what was actually paid for).
    const [receiptSnap0, sessSnap0] = await Promise.all([receiptRef.get(), sessionRef.get()]);
    const { receiptIds } = checkPaid(receiptSnap0, sessSnap0);
    const ids = [...receiptIds];
    if (ids.length === 0) return { ok: true, finalized: 0 };

    const nowMs = Date.now();
    let finalized = 0;
    const skipped: string[] = [];
    for (const id of ids) {
      const ref = db.doc(`loyaltyRedemptions/${id}`);
      const outcome = await db.runTransaction(async (tx): Promise<"done" | "noop" | "skip"> => {
        const [receiptSnap, sessSnap, snap] = await Promise.all([tx.get(receiptRef), tx.get(sessionRef), tx.get(ref)]);
        const current = checkPaid(receiptSnap, sessSnap);
        if (!snap.exists) return "skip";
        const r = snap.data() as any;
        if (r.appliedReceiptId === receiptId) return "noop"; // already finalized — idempotent
        if (r.appliedReceiptId) return "skip"; // consumed by another receipt
        if (!current.receiptIds.has(id) || !current.sessionIds.has(id)) return "skip"; // removed / not on this bill
        if (r.status !== "applied" || r.appliedStoreId !== storeId || r.appliedSessionId !== sessionId) return "skip";

        // The session is now PAID, so this is where a Hub voucher's points are
        // actually spent (claim only placed a hold). Docs already spent
        // (POS-created) skip the debit.
        const pointsCost = Math.floor(Number(r.pointsCost) || 0);
        const reservedPoints = Math.floor(Number(r.reservedPoints) || 0);
        const needsDebit = !r.pointsSpent && pointsCost > 0 && !!r.phone;

        if (needsDebit) {
          const customerRef = db.doc(`customers/${r.phone}`);
          const cSnap = await tx.get(customerRef);
          if (!cSnap.exists) return "skip";
          const c = cSnap.data() as any;
          const balance = Number(c.pointsBalance ?? 0);
          const held = Number(c.pointsReserved ?? 0);
          // The matching hold must still be there, and the debit must not drive
          // the balance (or the hold) negative.
          // A voucher with no hold (legacy) may only spend unheld points.
          const spendable = reservedPoints > 0 ? balance : balance - held;
          if (!Number.isFinite(balance) || !Number.isFinite(held) || held < reservedPoints || spendable < pointsCost) {
            return "skip";
          }
          tx.update(customerRef, {
            pointsBalance: FieldValue.increment(-pointsCost),
            pointsReserved: FieldValue.increment(-reservedPoints),
            updatedAt: FieldValue.serverTimestamp(),
          });
          // Deterministic ledger id so a torn retry can never write the same redeem twice.
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
          appliedReceiptId: receiptId,
          appliedAtMs: typeof r.appliedAtMs === "number" ? r.appliedAtMs : nowMs,
          lockedAtMs: nowMs,
          pointsSpent: true,
          pointsSpentAtMs: needsDebit ? nowMs : (typeof r.pointsSpentAtMs === "number" ? r.pointsSpentAtMs : nowMs),
          reservedPoints: 0,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return "done";
      });
      if (outcome === "done") finalized++;
      else if (outcome === "skip") skipped.push(id);
    }
    if (skipped.length) console.warn("[finalizeLoyaltyVouchers] skipped invalid redemptions:", skipped);
    return { ok: true, finalized, ...(skipped.length ? { skipped } : {}) };
  } catch (err: any) {
    const msg = err.message || String(err);
    console.error("[finalizeLoyaltyVouchers] failed:", msg);
    return { ok: false, finalized: 0, error: msg, ...(err instanceof LoyaltyFinalizeRejected ? { status: err.status } : {}) };
  }
}
