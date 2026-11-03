"use client";

import { doc, getDoc, setDoc } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/context/auth-context";
import type { Store, ModeOfPayment } from "@/lib/types";
import { stripUndefined } from "@/lib/firebase/utils";
import { calculateBillTotals } from "@/lib/tax";
import {
  getActorStamp,
  getCurrentSessionBillingState,
} from "@/components/cashier/firestore";
import {
  nextDailySeq,
  formatOfflineReceiptNumber,
} from "@/lib/offline/offlineReceiptNumber";
import { deviceReceiptTag, getBrowserDeviceId } from "@/lib/offline/browserDevice";
import { buildOfflinePaymentSummary } from "@/lib/offline/offlinePaymentSummary";
import { addToQueue } from "@/lib/offline/payment-queue";
import { getOperatorSessionToken } from "@/lib/pos-commands/client";
import {
  planGatewayChecks,
  verifyBridgeTender,
  verifyReservationTender,
  type CheckoutPayment,
} from "@/components/cashier/gatewayTenders";

/**
 * Records an offline sale as an immutable provisional command (audit P1 /
 * B16 / B17). Validates from the local cache exactly as before (totals, bill
 * revision, cached gateway bridge, tenders), mints the OL receipt number, then
 * persists the command durably (localStorage queue first, then the create-only
 * Firestore doc) BEFORE reporting success. No canonical doc (receipt, session
 * close, table release, counters) is written on the till: the server settles
 * the command on reconnect via /api/pos/commands/reconcile, transactionally,
 * only if the bill, its revision and the table ownership still match. Until
 * then the till shows the bill as "pending settlement" from the local queue.
 */
export async function completePaymentOffline(
  storeId: string,
  sessionId: string,
  user: AppUser,
  payments: CheckoutPayment[],
  store: Store,
  paymentMethods: ModeOfPayment[],
  expectedTotal?: number,
): Promise<{ receiptId: string; receiptNumber: string }> {
  // 1. Billing state + totals (cache-served reads).
  const billingState = await getCurrentSessionBillingState(storeId, sessionId);
  const { billLines, billDiscount, customAdjustments, loyaltyRedemptions } = billingState;
  const loyaltyDiscountInput = (loyaltyRedemptions || []).map((r) => ({ type: r.type, value: r.value }));
  const finalTotals = calculateBillTotals(billLines, store, billDiscount, customAdjustments, loyaltyDiscountInput);
  const amountDue = finalTotals.grandTotal;
  if (typeof expectedTotal === "number" && Math.abs(Math.round(expectedTotal * 100) - Math.round(amountDue * 100)) > 1) {
    throw new Error(`Bill changed before payment could be finalized. Review the bill and collect ₱${amountDue.toFixed(2)}.`);
  }

  const now = Date.now();
  const [sessionSnap, receiptSnap, activeProjectionSnap] = await Promise.all([
    getDoc(doc(db, `stores/${storeId}/sessions`, sessionId)),
    getDoc(doc(db, `stores/${storeId}/receipts`, sessionId)),
    getDoc(doc(db, `stores/${storeId}/activeSessions`, sessionId)),
  ]);

  const sessionData = sessionSnap.data() as any;
  if (!sessionData) throw new Error(`Session ${sessionId} is not available offline. Open it while online first.`);

  // Already finalized (as far as this device knows).
  if (receiptSnap.exists() || sessionData.status === "closed" || sessionData.isPaid === true) {
    const existingNumber = (receiptSnap.data()?.receiptNumber as string) || "";
    return { receiptId: sessionId, receiptNumber: existingNumber };
  }

  // Billing-revision concurrency guard (same as online).
  const currentBillingRevision = Number(sessionData.billingRevision ?? 0);
  if (currentBillingRevision !== billingState.billingRevision) {
    throw new Error("Bill changed during payment. Review the bill and try again.");
  }

  // 1b. Gateway (PayMongo QR) tenders must match a paid bridge doc for this
  // session (audit B03). Offline we can only read the cached copy; the server
  // re-verifies and consumes it authoritatively at reconciliation.
  for (const check of planGatewayChecks(payments, paymentMethods)) {
    let problem: string | null;
    try {
      if (check.kind === "bridge") {
        const bSnap = await getDoc(doc(db, `stores/${storeId}/paymentIntents`, check.intentDocId));
        problem = verifyBridgeTender(check, bSnap.exists() ? bSnap.data() : null, { storeId, sessionId });
      } else {
        const reservationId = sessionData.reservationId;
        const rSnap = reservationId ? await getDoc(doc(db, `stores/${storeId}/reservations`, String(reservationId))) : null;
        problem = verifyReservationTender(check, rSnap?.exists() ? rSnap.data() : null, { sessionId });
      }
    } catch {
      problem = "A scan-to-pay tender can't be verified offline. Reconnect to finish this payment.";
    }
    if (problem) throw new Error(problem);
  }

  // 2. Tender/change validation + MOP (pure, shared with tests).
  const amountDueCents = Math.round(Number(amountDue || 0) * 100);
  const summary = buildOfflinePaymentSummary({ payments, paymentMethods, amountDueCents });

  // 3. Mint the local OL receipt number (must not crash the sale on corruption).
  let seq: number;
  try {
    seq = nextDailySeq(window.localStorage, new Date());
  } catch (e) {
    throw new Error("Offline receipt numbering is unavailable on this device. Reconnect to take payment, or contact support.");
  }
  const deviceTag = deviceReceiptTag(getBrowserDeviceId());
  const receiptNumber = formatOfflineReceiptNumber({ storeCode: store.code, deviceTag, date: new Date(), seq });

  // 4. The immutable command (contract: docs/audit/pos-financial-commands.md §4).
  const opId = uuidv4();
  const actor = getActorStamp(user);
  const projData: any = activeProjectionSnap.exists() ? activeProjectionSnap.data() : {};
  const command = buildOfflineCheckoutCommand({
    opId,
    storeId,
    sessionId,
    terminalId: getBrowserDeviceId(),
    createdByUid: user.uid,
    clientCreatedAtMs: now,
    operatorSessionToken: getOperatorSessionToken(storeId),
    sessionRevision: Number(sessionData.revision ?? 1),
    billingRevision: currentBillingRevision,
    tableId: sessionData.tableId && sessionData.tableId !== "alacarte" ? String(sessionData.tableId) : null,
    totalCents: amountDueCents,
    receiptNumber,
    receiptSeq: seq,
    payments,
    lines: billLines,
  });

  // What the till shows / prints while settlement is pending (same fields the
  // receipt page reads from a receipt doc).
  const provisionalReceipt = stripUndefined({
    id: sessionId,
    receiptId: sessionId,
    sessionId,
    storeId,
    receiptNumber,
    pendingSettlement: true,
    createdByUsername: actor.username,
    createdAtClientMs: now,
    sessionMode: sessionData.sessionMode,
    tableNumber: sessionData.sessionMode === "alacarte" ? null : sessionData.tableNumber ?? null,
    customerName: sessionData.customer?.name ?? sessionData.customerName ?? null,
    lines: billLines,
    total: amountDue,
    totalPaid: summary.totalPaid,
    change: summary.change,
    analytics: {
      v: 2,
      subtotal: finalTotals.subtotal,
      discountsTotal: finalTotals.totalDiscounts,
      chargesTotal: finalTotals.chargesTotal,
      taxAmount: finalTotals.taxTotal,
      vatableSales: finalTotals.vatableSales,
      vatExemptSales: finalTotals.vatExemptSales,
      grandTotal: finalTotals.grandTotal,
      totalPaid: summary.totalPaid,
      change: summary.change,
      mop: summary.mopMap,
    },
  });

  // 5. Durable record #1 BEFORE the sale is accepted locally (audit B17): if
  // it can't be saved the payment is NOT taken.
  try {
    addToQueue({
      storeId,
      sessionId,
      receiptId: sessionId,
      receiptNumber,
      opId,
      kind: "payment",
      command,
      provisionalReceipt,
      ctx: {
        pin: projData.customerPin ? String(projData.customerPin) : null,
        phone: projData.linkedCustomerPhone ? String(projData.linkedCustomerPhone) : null,
        amount: amountDue,
        tenders: payments.map((p) => ({ methodId: p.methodId, amount: p.amount, reference: p.reference ?? null })),
      },
      // Effects run from the server outbox once the command is accepted.
      effects: { analytics: "skip", loyaltyFinalize: "skip", loyaltyEarn: "skip", pinFinalize: "skip", loyaltyReverse: "skip" },
    });
  } catch {
    throw new Error("This device couldn't save the offline sale record, so the payment was not taken. Free up browser storage or reconnect, then try again.");
  }

  // 6. Durable record #2: the create-only command doc, local-first (kept in
  // Firestore's persistent cache across restarts). A denied/failed sync is not
  // fatal: reconcile accepts the localStorage copy above.
  writeOfflineCommand(storeId, opId, command);

  return { receiptId: sessionId, receiptNumber };
}

/** Pure builder for the offline checkout command (unit-tested). */
export function buildOfflineCheckoutCommand(a: {
  opId: string;
  storeId: string;
  sessionId: string;
  terminalId: string;
  createdByUid: string;
  clientCreatedAtMs: number;
  operatorSessionToken: string | null;
  sessionRevision: number;
  billingRevision: number;
  tableId: string | null;
  totalCents: number;
  receiptNumber: string;
  receiptSeq: number;
  payments: CheckoutPayment[];
  /** Lines as charged, kept so a manager can accept a rejected sale as recorded. */
  lines?: unknown[];
}): Record<string, unknown> {
  return stripUndefined({
    schema: 1,
    opId: a.opId,
    kind: "checkout",
    // Server sweep index: false until the server resolves the command.
    resolved: false,
    storeId: a.storeId,
    sessionId: a.sessionId,
    terminalId: a.terminalId,
    createdByUid: a.createdByUid,
    clientCreatedAtMs: a.clientCreatedAtMs,
    operatorSessionToken: a.operatorSessionToken,
    expected: {
      sessionRevision: a.sessionRevision,
      billingRevision: a.billingRevision,
      tableId: a.tableId,
      totalCents: a.totalCents,
    },
    payload: {
      receiptNumber: a.receiptNumber,
      receiptSeq: a.receiptSeq,
      payments: a.payments.map((p) => stripUndefined({
        methodId: p.methodId,
        amount: Math.round(Number(p.amount) * 100) / 100,
        reference: p.reference ?? null,
        intentDocId: p.intentDocId ?? null,
        fromReservationPaymentId: p.fromReservationPaymentId ?? null,
      })),
      ...(a.lines ? { lines: JSON.parse(JSON.stringify(a.lines)) } : {}),
    },
  });
}

/** Local-first create of stores/{s}/posCommands/{opId}; never awaited. */
export function writeOfflineCommand(storeId: string, opId: string, command: Record<string, unknown>) {
  try {
    void setDoc(doc(db, "stores", storeId, "posCommands", opId), command).catch((err) => {
      console.warn("[offline] posCommands sync failed; reconcile will use the local copy", err);
    });
  } catch (err) {
    console.warn("[offline] posCommands write failed; reconcile will use the local copy", err);
  }
}
