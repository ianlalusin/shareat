"use client";

import {
  doc,
  collection,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/firebase/client";
import { servedQtyFields } from "@/lib/kitchen/served-qty";
import type { AppUser } from "@/context/auth-context";
import type { Payment, Store, ModeOfPayment } from "@/lib/types";
import { stripUndefined } from "@/lib/firebase/utils";
import { calculateBillTotals } from "@/lib/tax";
import {
  getActorStamp,
  getCurrentSessionBillingState,
} from "@/components/cashier/firestore";
import { commitLocalFirst } from "@/lib/offline/commit";
import {
  nextDailySeq,
  formatOfflineReceiptNumber,
} from "@/lib/offline/offlineReceiptNumber";
import { deviceReceiptTag, getBrowserDeviceId } from "@/lib/offline/browserDevice";
import { buildOfflinePaymentSummary } from "@/lib/offline/offlinePaymentSummary";
import { addToQueue, updateQueueItem } from "@/lib/offline/payment-queue";
import { toast } from "@/hooks/use-toast";
import {
  planGatewayChecks,
  verifyBridgeTender,
  verifyReservationTender,
  type CheckoutPayment,
} from "@/components/cashier/gatewayTenders";

/**
 * Records a completed sale entirely from the local Firestore cache — no
 * network. Mirrors the CORE of completePaymentFromUnits (reads → checks →
 * receipt → close → free table → mark tickets served) but: (1) reads from
 * cache via getDoc/getDocs; (2) mints a local OL receipt number instead of the
 * server counter; (3) writes via a single writeBatch committed local-first;
 * (4) defers ALL server-only effects (analytics, KDS rollups, loyalty, PINs)
 * to sync. Online sales still go through completePaymentFromUnits unchanged.
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
  const sessionRef = doc(db, `stores/${storeId}/sessions`, sessionId);
  const receiptRef = doc(db, `stores/${storeId}/receipts`, sessionId);
  const activeProjectionRef = doc(db, `stores/${storeId}/activeSessions`, sessionId);

  const [sessionSnap, receiptSnap, activeProjectionSnap] = await Promise.all([
    getDoc(sessionRef),
    getDoc(receiptRef),
    getDoc(activeProjectionRef),
  ]);

  const sessionData = sessionSnap.data() as any;
  if (!sessionData) throw new Error(`Session ${sessionId} is not available offline. Open it while online first.`);

  // Idempotency: already finalized.
  if ((receiptSnap.exists() && receiptSnap.data()?.analyticsApplied) || sessionData.status === "closed" || sessionData.isPaid === true) {
    const existingNumber = (receiptSnap.data()?.receiptNumber as string) || "";
    return { receiptId: receiptSnap.exists() ? receiptSnap.id : sessionId, receiptNumber: existingNumber };
  }

  // Billing-revision concurrency guard (same as online).
  const currentBillingRevision = Number(sessionData.billingRevision ?? 0);
  if (currentBillingRevision !== billingState.billingRevision) {
    throw new Error("Bill changed during payment. Review the bill and try again.");
  }

  // 1b. Gateway (PayMongo QR) tenders must match a paid bridge doc for this
  // session (audit B03). Offline we can only read the cached copy the QR
  // overlay / recovery query already loaded; if it isn't cached, refuse.
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

  // 4. Build the local-first batch.
  const actor = getActorStamp(user);
  const serverTs = serverTimestamp();
  const batch = writeBatch(db);
  // Audit B16: a fresh id per offline write. firestore.rules treats a session
  // update carrying a NEW offlineWriteId as a compare-and-swap (session must
  // still be open on the server, revision exactly +1) and a table update
  // carrying a new releasedByWriteId as "only if still seated by this session".
  // The batch is atomic, so a stale write is rejected whole on reconnect.
  const offlineWriteId = uuidv4();

  // payments subcollection
  const paymentsCol = collection(db, `stores/${storeId}/sessions`, sessionId, "payments");
  payments.forEach((payment) => {
    const paymentRef = doc(paymentsCol);
    batch.set(paymentRef, {
      ...payment,
      id: paymentRef.id,
      createdByUid: actor.uid,
      createdByUsername: actor.username,
      createdAt: serverTs,
    });
  });

  // mark active kitchen tickets served (local state; KDS rollups deferred)
  const ticketsRef = collection(db, "stores", storeId, "sessions", sessionId, "kitchentickets");
  const activeTicketsSnap = await getDocs(query(ticketsRef, where("status", "in", ["preparing", "ready"])));
  activeTicketsSnap.docs.forEach((t) => {
    const st = t.data() as any;
    if (st.status === "served" || st.status === "cancelled") return;
    // Same quantity bookkeeping the KDS "Served" button writes — see
    // `servedQtyFields`. KDS rollups are deferred on this path, so the fields
    // have to be right on the ticket for the later reconcile to read them.
    batch.update(t.ref, { status: "served", servedAt: serverTs, servedAtClientMs: now, servedByUid: actor.uid, updatedAt: serverTs, ...servedQtyFields(st) });
  });

  // close session (increment ownership revision)
  batch.update(sessionRef, {
    status: "closed",
    isPaid: true,
    closedByUid: actor.uid,
    closedByUsername: actor.username,
    closedAt: serverTs,
    closedAtClientMs: now,
    revision: Number(sessionData.revision ?? 1) + 1,
    offlineWriteId,
    updatedAt: serverTs,
  });

  // move projection active → closed
  const closedProjectionRef = doc(db, `stores/${storeId}/closedSessions`, sessionId);
  const projectionSource = activeProjectionSnap.exists() ? activeProjectionSnap.data() : sessionData;
  batch.set(closedProjectionRef, {
    ...projectionSource,
    status: "closed",
    customerAccessEnabled: false,
    updatedAt: serverTs,
    closedAt: serverTs,
    closedAtClientMs: now,
  });
  if (activeProjectionSnap.exists()) batch.delete(activeProjectionRef);

  // receipt doc — analytics DEFERRED (analyticsApplied:false, no baked analytics)
  const receiptPayload = stripUndefined({
    id: sessionId,
    storeId,
    sessionId,
    receiptId: sessionId,
    createdByUid: actor.uid,
    createdByUsername: actor.username,
    sessionMode: sessionData.sessionMode,
    tableId: sessionData.sessionMode === "alacarte" ? null : sessionData.tableId ?? null,
    tableNumber: sessionData.sessionMode === "alacarte" ? null : sessionData.tableNumber ?? null,
    customerName: sessionData.customer?.name ?? sessionData.customerName ?? null,
    total: amountDue,
    totalPaid: summary.totalPaid,
    change: summary.change,
    status: "final",
    receiptSeq: seq,
    receiptNumber,
    receiptNoFormatUsed: "OL",
    offlineOrigin: true,
    createdAtClientMs: now,
    lines: billLines,
    billDiscount: billDiscount ?? null,
    customAdjustments: customAdjustments ?? [],
    loyaltyRedemptions: loyaltyRedemptions ?? [],
    // Print-critical analytics baked in immediately so the receipt renders
    // correct money totals + MOP offline. Server-only aggregates (salesByItem,
    // salesByCategory, servedRefillsByName, serveCountByType,
    // serveTimeMsTotalByType, guestCountSnapshot) are DEFERRED — Plan 4's
    // sync-time analytics delta computes and applies those.
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
    analyticsApplied: false,
    analyticsApplyId: uuidv4(),
    createdAt: serverTs,
  });
  batch.set(receiptRef, receiptPayload);

  // free the table + its projection
  if (sessionData.tableId && sessionData.tableId !== "alacarte") {
    const tableRef = doc(db, `stores/${storeId}/tables`, sessionData.tableId);
    const tableSnap = await getDoc(tableRef);
    if (tableSnap.exists() && (tableSnap.data() as any).currentSessionId === sessionId) {
      batch.update(tableRef, {
        status: "available",
        currentSessionId: null,
        closedSessionId: sessionId,
        releasedByWriteId: offlineWriteId,
        updatedAt: serverTs,
      });
      const tableProjectionRef = doc(db, `stores/${storeId}/storeConfig/current/tables`, sessionData.tableId);
      batch.update(tableProjectionRef, {
        status: "available",
        currentSessionId: null,
        customerName: null,
        packageLabel: null,
        sessionType: null,
        guestCount: null,
        itemCount: null,
        startedAtMs: null,
        closedSessionId: sessionId,
        releasedByWriteId: offlineWriteId,
        updatedAt: serverTs,
      });
    }
  }

  // 5. Record the deferred-finalization marker BEFORE committing (audit B17).
  // If it can't be saved (localStorage full / blocked) the sale is NOT taken:
  // a closed sale with no marker would never get its loyalty / PIN / analytics
  // effects. The marker also keeps the receipt number + tenders so a sale the
  // server later rejects can be reconciled by hand.
  const projData: any = activeProjectionSnap.exists() ? activeProjectionSnap.data() : {};
  const pin = projData.customerPin ? String(projData.customerPin) : null;
  const phone = projData.linkedCustomerPhone ? String(projData.linkedCustomerPhone) : null;
  let queued: { id: string };
  try {
    queued = addToQueue({
      storeId,
      sessionId,
      receiptId: sessionId,
      receiptNumber,
      offlineWriteId,
      ctx: {
        pin,
        phone,
        amount: amountDue,
        tenders: payments.map((p) => ({ methodId: p.methodId, amount: p.amount, reference: p.reference ?? null })),
      },
      effects: {
        analytics: "pending",
        loyaltyFinalize: "pending",
        loyaltyEarn: phone ? "pending" : "skip",
        pinFinalize: pin ? "pending" : "skip",
        loyaltyReverse: "skip", // payment sales never reverse loyalty (void-only effect)
      },
    });
  } catch {
    throw new Error("This device couldn't save the offline sale record, so the payment was not taken. Free up browser storage or reconnect, then try again.");
  }

  // 6. Commit local-first (does not await the server ack that never comes offline).
  // A server rejection (e.g. the session was settled on another terminal, or the
  // table was re-seated) marks the queued sale failed so it is never replayed
  // as if accepted, and tells the cashier.
  commitLocalFirst(batch, (err) => {
    console.error("[completePaymentOffline] batch sync failed", err);
    const message = (err as any)?.message ?? String(err);
    updateQueueItem(queued.id, { status: "failed", errorMessage: `Server rejected offline sale: ${message}` });
    toast({
      variant: "destructive",
      title: "Offline sale was not accepted",
      description: `Receipt ${receiptNumber} (session ${sessionId.slice(0, 6)}…) was rejected by the server. Check this bill with a manager.`,
    });
  });

  return { receiptId: sessionId, receiptNumber };
}
