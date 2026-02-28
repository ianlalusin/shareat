

'use client';

import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
  getDocs,
  getDoc,
  updateDoc,
  runTransaction,
  query,
  where,
  deleteField,
  increment,
  type DocumentReference,
  type DocumentSnapshot,
  type DocumentData,
  type Firestore,
  type Transaction,
  type WriteBatch,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';

import { db } from '@/lib/firebase/client';
import { AppUser } from '@/context/auth-context';
import type {
  Store,
  StorePackage,
  Payment,
  ModeOfPayment,
  SessionBillLine,
  Discount,
  Adjustment,
  ReceiptAnalyticsV2,
  Receipt,
  KitchenTicket,
  LineAdjustment,
  PendingSession,
  OrderItemType,
} from '@/lib/types';

import { stripUndefined } from '@/lib/firebase/utils';
import { computeSessionLabel } from '@/lib/utils/session';
import { writeActivityLog } from '@/components/cashier/activity-log';
import { calculateBillTotals } from '@/lib/tax';
import { v4 as uuidv4 } from 'uuid';
import { applyAnalyticsDeltaV2 } from '@/lib/analytics/applyAnalyticsDeltaV2';
import { applyKdsTicketDelta } from '@/lib/analytics/applyKdsTicketDelta';
import { toJsDate } from '@/lib/utils/date';
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

export type ActorStamp = { uid: string; username: string; email?: string | null };

export function getActorStamp(user: AppUser): ActorStamp {
  const username =
    (user.displayName && user.displayName.trim()) ||
    ((user as any).name && String((user as any).name).trim()) ||
    (user.email ? user.email.split('@')[0] : '') ||
    user.uid.slice(0, 6);

  return { uid: user.uid, username, email: user.email ?? null };
}

export type StartSessionPayload = {
  tableId: string;
  tableNumber: string;
  displayName?: string;
  guestCount: number;
  customer?: { name?: string | null; tin?: string | null; address?: string | null };
  notes?: string;
  initialFlavorIds?: string[];
  package?: StorePackage; // Optional for ala carte
  sessionMode: 'package_dinein' | 'alacarte';
};

/**
 * Helper to disable customer PIN access within a transaction.
 * It finds the PIN from the session projection, deletes it from the pinRegistry,
 * and updates the active projection itself to reflect the disabled state.
 * @param tx The Firestore transaction object.
 * @param activeProjectionRef Reference to the active session projection document.
 * @param projectionSnap The DocumentSnapshot of the active session projection.
 */
function _disableCustomerPinInTx(
  tx: Transaction,
  activeProjectionRef: DocumentReference<DocumentData>,
  projectionSnap: DocumentSnapshot<DocumentData>
) {
  if (!projectionSnap.exists()) return;

  const pin = projectionSnap.data()?.customerPin;
  if (pin) tx.delete(doc(db, "pinRegistry", String(pin)));

  tx.set(
    activeProjectionRef,
    {
      customerAccessEnabled: false,
      customerPin: null,
      customerAccessExpiresAtMs: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}


/**
 * Formats a receipt number based on a template and a sequence number.
 * @param fmt The format string (e.g., "PREFIX-#####").
 * @param seq The sequence number.
 * @returns The formatted receipt number string.
 */
function formatReceiptNumber(fmt: string, seq: number): string {
  const m = fmt.match(/#+/g);
  if (!m) return `${fmt}${seq}`;

  const run = m.sort((a, b) => b.length - a.length)[0];
  const padded = String(seq).padStart(run.length, '0');
  return fmt.replace(run, padded);
}

/**
 * Starts a new dining session.
 * Creates session doc, table update, and initial kitchen/billing units.
 */
export async function startSession(storeId: string, payload: StartSessionPayload, user: AppUser) {
  const newSessionRef = doc(collection(db, `stores/${storeId}/sessions`));

  const isAlaCarte = payload.sessionMode === 'alacarte';
  const customerName = payload.customer?.name ?? null;
  const tableNumber = isAlaCarte ? null : payload.tableNumber;
  const tableDisplayName = payload.displayName || `Table ${payload.tableNumber}`;
  const sessionLabel = computeSessionLabel({ sessionMode: payload.sessionMode, customerName, tableDisplayName: tableDisplayName });

  const sessionPayload = stripUndefined({
    id: newSessionRef.id,
    storeId,
    tableId: payload.tableId,
    tableNumber,
    tableDisplayName,
    customerName,
    sessionLabel,
    status: isAlaCarte ? 'active' : 'pending_verification',
    sessionMode: payload.sessionMode,
    isPaid: false,
    startedAt: serverTimestamp(),
    startedAtClientMs: Date.now(),
    startedByUid: user.uid,
    guestCountCashierInitial: payload.guestCount,
    guestCountServerVerified: null,
    guestCountFinal: isAlaCarte ? null : payload.guestCount,
    guestCountVerifyLocked: isAlaCarte,
    verifiedAt: null,
    verifiedByUid: null,
    packageOfferingId: payload.package?.packageId || null,
    packageSnapshot: payload.package
      ? { name: payload.package.packageName, pricePerHead: payload.package.pricePerHead }
      : null,
    initialFlavorIds: payload.initialFlavorIds || [],
    customer: payload.customer,
    notes: payload.notes || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await runTransaction(db, async (transaction) => {
    // 1. Create the new session document
    transaction.set(newSessionRef, sessionPayload);

    // 2. Update the table document and its projection if not ala carte
    if (!isAlaCarte) {
      const tableRef = doc(db, `stores/${storeId}/tables`, payload.tableId);
      transaction.update(tableRef, {
        status: 'occupied',
        currentSessionId: newSessionRef.id,
        updatedAt: serverTimestamp(),
      });
      
      const tableProjectionRef = doc(db, `stores/${storeId}/storeConfig/current/tables`, payload.tableId);
      transaction.update(tableProjectionRef, {
        status: 'occupied',
        currentSessionId: newSessionRef.id,
        customerName: customerName,
        packageLabel: payload.package?.packageName || null,
        sessionType: payload.sessionMode,
        guestCount: payload.guestCount,
        startedAtMs: sessionPayload.startedAtClientMs,
        updatedAt: serverTimestamp(),
      });
    }

    // 3. Write session projection to the new location
    const sessionProjectionRef = doc(db, `stores/${storeId}/activeSessions`, newSessionRef.id);
    const projectionPayload = {
      id: newSessionRef.id,
      status: isAlaCarte ? 'active' : 'pending_verification',
      sessionMode: payload.sessionMode,
      tableId: payload.tableId,
      tableNumber: isAlaCarte ? null : payload.tableNumber,
      tableDisplayName: isAlaCarte ? null : tableDisplayName,
      customerName: customerName,
      packageOfferingId: payload.package?.packageId || null,
      packageName: payload.package?.packageName || null, // Denormalize for server page
      packageSnapshot: payload.package
        ? { name: payload.package.packageName, pricePerHead: payload.package.pricePerHead }
        : null,
      guestCountCashierInitial: payload.guestCount,
      guestCountFinal: isAlaCarte ? null : payload.guestCount,
      startedAt: serverTimestamp(),
      startedAtClientMs: sessionPayload.startedAtClientMs,
      updatedAt: serverTimestamp(),
      initialFlavorIds: payload.initialFlavorIds || [],
    };
    transaction.set(sessionProjectionRef, projectionPayload);


    // 4. Create package bill line and kitchen ticket if applicable
    if (payload.sessionMode === 'package_dinein' && payload.package) {
      const lineId = `package_${payload.package.packageId}`;
      const lineRef = doc(db, `stores/${storeId}/sessions/${newSessionRef.id}/sessionBillLines`, lineId);
      transaction.set(lineRef, {
        id: lineId,
        type: 'package',
        itemId: payload.package.packageId,
        itemName: payload.package.packageName,
        unitPrice: payload.package.pricePerHead,
        qtyOrdered: payload.guestCount,
        discountType: null,
        discountValue: 0,
        discountQty: 0,
        freeQty: 0,
        voidedQty: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
        updatedByName: getActorStamp(user).username,
      });

      const stationKey = payload.package.kitchenLocationId;
      if (!stationKey) {
        throw new Error(`Package with ID ${payload.package.packageId} does not have a kitchen location assigned.`);
      }
      const ticketRef = doc(collection(db, 'stores', storeId, 'sessions', newSessionRef.id, 'kitchentickets'));
      const ticketPayload = stripUndefined({
        id: ticketRef.id,
        sessionId: newSessionRef.id,
        storeId,
        tableId: payload.tableId,
        tableNumber: payload.tableNumber,
        tableDisplayName: tableDisplayName,
        type: 'package',
        itemId: payload.package.packageId,
        itemName: payload.package.packageName,
        guestCount: payload.guestCount,
        status: 'preparing',
        kitchenLocationId: stationKey,
        kitchenLocationName: payload.package.kitchenLocationName,
        notes: payload.notes || '',
        qty: 1,
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
        createdAtClientMs: Date.now(),
        sessionMode: 'package_dinein',
        customerName: payload.customer?.name,
        sessionLabel,
        initialFlavorIds: payload.initialFlavorIds,
      });
      transaction.set(ticketRef, ticketPayload);
      
      // KDS PROJECTION WRITE
      const rtKdsDocRef = doc(db, "stores", storeId, "rtKdsTickets", stationKey);
      transaction.set(rtKdsDocRef, {
        meta: { source: 'startSession', updatedAt: serverTimestamp() },
        kitchenLocationId: stationKey,
      }, { merge: true });
      transaction.update(rtKdsDocRef, {
          [`tickets.${ticketRef.id}`]: ticketPayload,
          activeIds: arrayUnion(ticketRef.id),
          [`sessionIndex.${newSessionRef.id}`]: arrayUnion(ticketRef.id)
      });
    }
  });


  // For package dine-in, this is the definitive start log.
  if (payload.sessionMode !== 'alacarte') {
    await writeActivityLog({
      storeId,
      sessionId: newSessionRef.id,
      user,
      action: 'SESSION_STARTED',
      note: 'Session started',
      sessionContext: {
        sessionStatus: sessionPayload.status as any,
        sessionStartedAt: sessionPayload.startedAt,
        sessionMode: sessionPayload.sessionMode ?? undefined,
        customerName: sessionPayload.customerName,
        tableNumber: sessionPayload.tableNumber,
      }
    });
  }

  return newSessionRef.id;
}


/**
 * Completes a payment and closes the dining session idempotently using individual billing units.
 * Uses a Firestore transaction to ensure atomicity.
 */
export async function completePaymentFromUnits(
  storeId: string,
  sessionId: string,
  user: AppUser,
  payments: Payment[],
  billLines: SessionBillLine[],
  store: Store,
  paymentMethods: ModeOfPayment[],
  billDiscount: Discount | null,
  customAdjustments: Adjustment[]
) {
  let finalReceipt: Receipt | null = null;
  let receiptId = '';
  let sessionContextForLog: any = null;
  let finalReceiptNumber: string | null = null;

  const finalTotals = calculateBillTotals(billLines, store, billDiscount, customAdjustments);
  const amountDue = finalTotals.grandTotal;
  const now = Date.now();

  await runTransaction(db, async (tx: Transaction) => {
    // --- READ PHASE ---
    const sessionRef = doc(db, `stores/${storeId}/sessions`, sessionId);
    const settingsRef = doc(db, `stores/${storeId}/receiptSettings`, 'main');
    const counterRef = doc(db, `stores/${storeId}/counters`, 'receipts');
    const receiptRef = doc(db, `stores/${storeId}/receipts`, sessionId);
    const activeProjectionRef = doc(db, `stores/${storeId}/activeSessions`, sessionId);
    
    const [
      sessionSnap, receiptSnap, settingsSnap, counterSnap, activeProjectionSnap
    ] = await Promise.all([
      tx.get(sessionRef),
      tx.get(receiptRef),
      tx.get(settingsRef),
      tx.get(counterRef),
      tx.get(activeProjectionRef),
    ]);
    
    // Disable any active PIN associated with this session.
    _disableCustomerPinInTx(tx, activeProjectionRef, activeProjectionSnap);


    const ticketsRef = collection(db, "stores", storeId, "sessions", sessionId, "kitchentickets");
    const activeTicketsQuery = query(ticketsRef, where("status", "in", ['preparing', 'ready']));
    const activeTicketsSnap = await getDocs(activeTicketsQuery);
    
    const sessionData = sessionSnap.data();
    if (!sessionData) throw new Error(`Session ${sessionId} does not exist.`);

    sessionContextForLog = {
      sessionStatus: 'closed',
      sessionStartedAt: sessionData.startedAt,
      sessionMode: sessionData.sessionMode,
      customerName: sessionData.customer?.name ?? sessionData.customerName,
      tableNumber: sessionData.tableNumber,
    };

    if (receiptSnap.exists() && receiptSnap.data()?.analyticsApplied) {
      console.warn(`Payment completion skipped: Analytics for session ${sessionId} already applied.`);
      receiptId = receiptRef.id;
      return;
    }
    if (sessionData.status === 'closed' || sessionData.isPaid === true) {
      console.warn(`Payment completion skipped: Session ${sessionId} is already closed.`);
      receiptId = receiptSnap.exists() ? receiptSnap.id : '';
      return;
    }

    let tableRef: DocumentReference<DocumentData> | null = null;
    let tableSnap: DocumentSnapshot<DocumentData> | null = null;

    if (sessionData.tableId && sessionData.tableId !== 'alacarte') {
      tableRef = doc(db, `stores/${storeId}/tables`, sessionData.tableId);
      tableSnap = await tx.get(tableRef);
    }
    
    const totalPaidCents = payments.reduce((s, p) => s + Math.round(Number(p.amount || 0) * 100), 0);
    const amountDueCents = Math.round(Number(amountDue || 0) * 100);

    if (totalPaidCents < amountDueCents - 1) { // Allow 1c rounding difference
      throw new Error(
        `Cannot complete payment: balance is not zero. Paid: ₱${(totalPaidCents / 100).toFixed(
          2
        )}, Due: ₱${(amountDueCents / 100).toFixed(2)}`
      );
    }

    const actor = getActorStamp(user);
    const serverTs = serverTimestamp();

    // Mark remaining active tickets as served
    for (const ticketDoc of activeTicketsSnap.docs) {
      const ticketRef = ticketDoc.ref;
      const oldTicketState = ticketDoc.data() as KitchenTicket;
      
      if (oldTicketState.status === 'served' || oldTicketState.status === 'cancelled') {
          continue;
      }
      
      const startMs = toJsDate(oldTicketState.createdAtClientMs ?? oldTicketState.createdAt)?.getTime();
      const durationMs = startMs ? Math.max(0, now - startMs) : 0;
      
      const updatePayload: any = {
          status: 'served',
          servedAt: serverTs,
          servedAtClientMs: now,
          servedByUid: actor.uid,
          durationMs: durationMs,
      };

      const newTicketState: KitchenTicket = { ...oldTicketState, ...updatePayload };
      
      await applyKdsTicketDelta(db, storeId, oldTicketState, newTicketState, { tx });
      tx.update(ticketRef, updatePayload);
      
      const { kitchenLocationId } = oldTicketState;
      if (kitchenLocationId) {
          const rtKdsDocRef = doc(db, "stores", storeId, "rtKdsTickets", kitchenLocationId);
          tx.update(rtKdsDocRef, {
              [`tickets.${ticketRef.id}`]: deleteField(),
              activeIds: arrayRemove(ticketRef.id),
              [`sessionIndex.${sessionId}`]: arrayRemove(ticketRef.id),
              "meta.updatedAt": serverTimestamp(),
          });
          const closedTicketRef = doc(db, "stores", storeId, "rtKdsTickets", kitchenLocationId, "closedKdsTickets", ticketRef.id);
          tx.set(closedTicketRef, newTicketState);
      }
    }
    
    // write payments subcollection
    const paymentsCol = collection(db, `stores/${storeId}/sessions`, sessionId, 'payments');
    payments.forEach((payment) => {
      const paymentRef = doc(paymentsCol);
      tx.set(paymentRef, {
        ...payment,
        id: paymentRef.id,
        createdByUid: actor.uid,
        createdByUsername: actor.username,
        createdAt: serverTs,
      });
    });

    // close session
    tx.update(sessionRef, {
      status: 'closed',
      isPaid: true,
      closedByUid: actor.uid,
      closedByUsername: actor.username,
      closedAt: serverTs,
      closedAtClientMs: now,
      updatedAt: serverTs,
    });
    
    // Move session projection
    const closedProjectionRef = doc(db, `stores/${storeId}/closedSessions`, sessionId);
    if (activeProjectionSnap.exists()) {
      const projectionData = activeProjectionSnap.data();
      tx.set(closedProjectionRef, {
        ...projectionData,
        status: 'closed',
        customerAccessEnabled: false,
        customerPin: null,
        customerAccessExpiresAtMs: null,
        updatedAt: serverTimestamp(),
        closedAt: serverTimestamp(),
      });
      tx.delete(activeProjectionRef);
    } else { // Fallback if projection was missing
        tx.set(closedProjectionRef, {
            ...sessionData,
            status: 'closed',
            customerAccessEnabled: false,
            customerPin: null,
            customerAccessExpiresAtMs: null,
            updatedAt: serverTimestamp(),
            closedAt: serverTimestamp(),
        })
    }

    // receipt numbering
    const receiptNoFormat = settingsSnap.exists()
      ? settingsSnap.data()?.receiptNoFormat ?? 'SELIP-######'
      : 'SELIP-######';

    const currentSeq = counterSnap.exists() ? Number(counterSnap.data()?.seq ?? 0) : 0;
    const nextSeq = currentSeq + 1;

    tx.set(counterRef, { seq: nextSeq, updatedAt: serverTs }, { merge: true });

    const receiptNumber = formatReceiptNumber(receiptNoFormat, nextSeq);
    finalReceiptNumber = receiptNumber;

    const mopCentsMap: Record<string, number> = {};
    for (const payment of payments) {
        const method = paymentMethods.find((m) => m.id === payment.methodId);
        const key = method?.name || payment.methodId || "unknown";
        mopCentsMap[key] = (mopCentsMap[key] || 0) + Math.round(Number(payment.amount || 0) * 100);
    }
    const changeCents = Math.max(0, totalPaidCents - amountDueCents);
    if (changeCents > 0) {
        const cashMethod =
          paymentMethods.find((pm: any) => String(pm.type || "").toLowerCase() === "cash") ||
          paymentMethods.find((pm: any) => String(pm.name || "").toLowerCase().includes("cash"));
        let cashKey = cashMethod?.name;
        if (!cashKey) cashKey = Object.keys(mopCentsMap).find((k) => k.toLowerCase().includes("cash"));
        if (!cashKey || mopCentsMap[cashKey] == null) {
          throw new Error("Change exists but no Cash payment was included. Add Cash payment.");
        }
        if (mopCentsMap[cashKey] < changeCents) {
            throw new Error(`Invalid payment: change (₱${(changeCents / 100).toFixed(2)}) exceeds cash paid (₱${(mopCentsMap[cashKey] / 100).toFixed(2)}).`);
        }
        mopCentsMap[cashKey] -= changeCents;
    }
    const mopMap: Record<string, number> = {};
    for (const [key, cents] of Object.entries(mopCentsMap)) {
        mopMap[key] = cents / 100;
    }
    
    const totalPaid = totalPaidCents / 100;
    const change = changeCents / 100;

    const receiptPayload: Omit<Receipt, 'createdAt'> = stripUndefined({
      id: sessionId, storeId, sessionId, createdByUid: actor.uid, createdByUsername: actor.username,
      sessionMode: sessionData.sessionMode,
      tableId: sessionData.sessionMode === 'alacarte' ? null : sessionData.tableId ?? null,
      tableNumber: sessionData.sessionMode === 'alacarte' ? null : sessionData.tableNumber ?? null,
      customerName: sessionData.customer?.name ?? sessionData.customerName ?? null,
      total: amountDue, totalPaid, change, status: 'final',
      receiptSeq: nextSeq, receiptNumber, receiptNoFormatUsed: receiptNoFormat,
      createdAtClientMs: Date.now(), lines: billLines,
    } as Omit<Receipt, 'createdAt'>);

    const salesAnalytics = billLines.reduce(
        (acc, line) => {
            if (line.type !== 'package' && line.type !== 'addon') return acc;
            const netQty = Math.max(0, line.qtyOrdered - (line.freeQty || 0) - (line.voidedQty || 0));
            if (netQty <= 0) return acc;
            const grossAmount = netQty * line.unitPrice;
            const discountBaseUnit = store.taxType === 'VAT_INCLUSIVE' && store.taxRatePct && store.taxRatePct > 0 ? line.unitPrice / (1 + store.taxRatePct / 100) : line.unitPrice;
            const adjs = Object.values((line as any).lineAdjustments ?? {}) as LineAdjustment[];
            const discountAdjs = adjs.filter(a => a.kind === "discount").sort((a, b) => (a.createdAtClientMs || 0) - (b.createdAtClientMs || 0));
            let discountAmount = 0;
            if (discountAdjs.length > 0) {
              let remaining = netQty;
              for (const a of discountAdjs) {
                const q = Math.min(Number(a.qty || 0), remaining);
                if (q <= 0) continue;
                if (a.type === "percent") discountAmount += q * discountBaseUnit * ((Number(a.value || 0)) / 100);
                else discountAmount += Math.min(discountBaseUnit, Number(a.value || 0)) * q;
                remaining -= q;
                if (remaining <= 0) break;
              }
            } else {
              const discountQty = Math.min(line.discountQty || 0, netQty);
              if (discountQty > 0) {
                if (line.discountType === 'percent') discountAmount = discountQty * discountBaseUnit * ((line.discountValue || 0) / 100);
                else discountAmount = Math.min(discountBaseUnit, line.discountValue ?? 0) * discountQty;
              }
            }
            const netAmount = grossAmount - discountAmount;
            const categoryName = (line as any).category || 'Uncategorized';
            acc.salesByItem ??= {}; acc.salesByCategory ??= {};
            if (!acc.salesByItem[line.itemName]) acc.salesByItem[line.itemName] = { qty: 0, amount: 0, categoryName };
            acc.salesByItem[line.itemName].qty += netQty; acc.salesByItem[line.itemName].amount += netAmount;
            if (!acc.salesByCategory[categoryName]) acc.salesByCategory[categoryName] = { qty: 0, amount: 0 };
            acc.salesByCategory[categoryName].qty += netQty; acc.salesByCategory[categoryName].amount += netAmount;
            return acc;
        },
        {} as { salesByItem?: ReceiptAnalyticsV2['salesByItem']; salesByCategory?: ReceiptAnalyticsV2['salesByCategory']; }
    );
    let guestCountSnapshot: ReceiptAnalyticsV2['guestCountSnapshot'] | undefined = undefined;
    if (sessionData.sessionMode === 'package_dinein') {
      const cashierInitial = sessionData.guestCountCashierInitial ?? 0;
      const serverVerified = sessionData.guestCountServerVerified ?? 0;
      const finalGuestCount = sessionData.guestCountFinal ?? Math.max(cashierInitial, serverVerified);
      const pkgLine = billLines.find((l) => l.type === 'package');
      const billedPackageCovers = Math.max(0, (pkgLine?.qtyOrdered ?? 0) - (pkgLine?.voidedQty ?? 0) - (pkgLine?.freeQty ?? 0));
      const discrepancy = billedPackageCovers - finalGuestCount;
      const packageOfferingId = sessionData.packageOfferingId ?? null;
      const packageName = sessionData.packageSnapshot?.name ?? pkgLine?.itemName ?? null;
      guestCountSnapshot = { packageOfferingId, packageName, finalGuestCount, billedPackageCovers, discrepancy, computedAtClientMs: Date.now(), rule: 'MAX', };
    }

    const analyticsV2: ReceiptAnalyticsV2 = {
      v: 2,
      sessionStartedAt: sessionData.startedAt ?? sessionData.createdAt ?? null, sessionStartedAtClientMs: sessionData.startedAtClientMs ?? null,
      sessionStartedAtHour: (new Date(sessionData.startedAtClientMs ?? Date.now())).getHours(),
      subtotal: finalTotals.subtotal, discountsTotal: finalTotals.totalDiscounts, chargesTotal: finalTotals.chargesTotal,
      taxAmount: finalTotals.taxTotal, grandTotal: finalTotals.grandTotal, totalPaid, change, mop: mopMap,
      salesByItem: salesAnalytics.salesByItem, salesByCategory: salesAnalytics.salesByCategory,
      servedRefillsByName: sessionData.servedRefillsByName || {},
      serveCountByType: sessionData.serveCountByType || {},
      serveTimeMsTotalByType: sessionData.serveTimeMsTotalByType || {},
      guestCountSnapshot,
    };
    
    finalReceipt = { ...receiptPayload, analytics: analyticsV2, createdAt: serverTs, analyticsApplied: true, analyticsAppliedAt: serverTs, analyticsApplyId: uuidv4() } as Receipt;
    
    await applyAnalyticsDeltaV2(db, storeId, null, finalReceipt, { tx });
    tx.set(receiptRef, finalReceipt);
    receiptId = receiptRef.id;

    if (tableSnap && tableRef && tableSnap.exists()) {
      const t = tableSnap.data() as any;
      if (t.currentSessionId === sessionId) {
        tx.update(tableRef, { status: 'available', currentSessionId: null, updatedAt: serverTs });
        
        const tableProjectionRef = doc(db, `stores/${storeId}/storeConfig/current/tables`, sessionData.tableId);
        tx.update(tableProjectionRef, {
          status: 'available',
          currentSessionId: null,
          customerName: null,
          packageLabel: null,
          sessionType: null,
          guestCount: null,
          itemCount: null,
          startedAtMs: null,
          updatedAt: serverTimestamp(),
        });
      }
    }
  });

  if (receiptId) {
    await writeActivityLog({
      storeId, sessionId, user, action: 'PAYMENT_COMPLETED', note: 'Payment completed',
      sessionContext: sessionContextForLog,
      meta: { receiptId, receiptNumber: finalReceiptNumber ?? undefined, paymentTotal: amountDue },
    });
  }

  return receiptId;
}

export async function voidSession({
  storeId,
  sessionId,
  reason,
  actor,
}: {
  storeId: string;
  sessionId: string;
  reason: string;
  actor: AppUser;
}) {
  const safeReason = (reason ?? '').toString().trim();
  const sessionRef = doc(db, 'stores', storeId, 'sessions', sessionId);
  const nowMs = Date.now();
  
  const ticketsRef = collection(db, "stores", storeId, "sessions", sessionId, "kitchentickets");
  const activeTicketsQuery = query(ticketsRef, where("status", "in", ['preparing', 'ready']));
  const activeTicketsSnap = await getDocs(activeTicketsQuery);

  await runTransaction(db, async (tx: Transaction) => {
    // New projection paths
    const activeProjectionRef = doc(db, `stores/${storeId}/activeSessions`, sessionId);
    const closedProjectionRef = doc(db, `stores/${storeId}/closedSessions`, sessionId);

    const [sessionSnap, activeProjectionSnap] = await Promise.all([
        tx.get(sessionRef),
        tx.get(activeProjectionRef),
    ]);
    
    _disableCustomerPinInTx(tx, activeProjectionRef, activeProjectionSnap);


    if (!sessionSnap.exists()) throw new Error("Session disappeared during transaction.");
    const sessionData = sessionSnap.data() as any;
    if (sessionData.status === 'closed' || sessionData.status === 'voided' || sessionData.isPaid) {
      console.warn(`voidSession skipped: Session ${sessionId} was already finalized.`);
      return;
    }
    
    // Cancel any remaining active tickets
    for (const ticketDoc of activeTicketsSnap.docs) {
        const ticketRef = ticketDoc.ref;
        const oldTicketState = ticketDoc.data() as KitchenTicket;
        const updatePayload = {
            status: 'cancelled' as const,
            cancelledAt: serverTimestamp(),
            cancelledAtClientMs: nowMs,
            cancelledByUid: actor.uid,
            cancelReason: "Session Voided",
        };
        const newTicketState = { ...oldTicketState, ...updatePayload };

        tx.update(ticketRef, updatePayload);
        
        const stationId = ticketDoc.data().kitchenLocationId;
        if(stationId) {
            const rtKdsDocRef = doc(db, "stores", storeId, "rtKdsTickets", stationId);
            tx.update(rtKdsDocRef, {
                [`tickets.${ticketRef.id}`]: deleteField(),
                activeIds: arrayRemove(ticketRef.id),
                [`sessionIndex.${sessionId}`]: arrayRemove(ticketRef.id),
                "meta.updatedAt": serverTimestamp(),
            });
            // Add to historical view
            const closedTicketRef = doc(db, "stores", storeId, "rtKdsTickets", stationId, "closedKdsTickets", ticketRef.id);
            tx.set(closedTicketRef, newTicketState);
        }
    }

    tx.update(sessionRef, { status: 'voided', voidedAt: serverTimestamp(), voidedByUid: actor.uid, voidedByUsername: getActorStamp(actor).username, voidReason: safeReason, updatedAt: serverTimestamp() });
    
    // Move projection from active to closed
    if (activeProjectionSnap.exists()) {
      const projectionData = activeProjectionSnap.data();
      tx.set(closedProjectionRef, {
        ...projectionData,
        status: 'voided',
        customerAccessEnabled: false,
        customerPin: null,
        customerAccessExpiresAtMs: null,
        updatedAt: serverTimestamp(),
        closedAt: serverTimestamp(),
      });
      tx.delete(activeProjectionRef);
    }
    
    if (sessionData.tableId && sessionData.tableId !== 'alacarte') {
      const tableRef = doc(db, 'stores', storeId, 'tables', sessionData.tableId);
      tx.update(tableRef, { status: 'available', currentSessionId: null, updatedAt: serverTimestamp() });
      
      const tableProjectionRef = doc(db, `stores/${storeId}/storeConfig/current/tables`, sessionData.tableId);
      tx.update(tableProjectionRef, {
        status: 'available',
        currentSessionId: null,
        customerName: null,
        packageLabel: null,
        sessionType: null,
        guestCount: null,
        itemCount: null,
        startedAtMs: null,
        updatedAt: serverTimestamp(),
      });
    }
  });

  const sessionDocAfter = await getDoc(sessionRef);
  const initialSessionData = sessionDocAfter.data();

  if (initialSessionData) {
    await writeActivityLog({
      storeId, sessionId, user: actor, action: "SESSION_VOIDED", reason: safeReason,
      sessionContext: {
          sessionStatus: 'voided', sessionStartedAt: initialSessionData.startedAt,
          sessionMode: initialSessionData.sessionMode ?? undefined,
          customerName: initialSessionData.customer?.name ?? initialSessionData.customerName,
          tableNumber: initialSessionData.tableNumber,
      },
      meta: { sessionLabel: computeSessionLabel(initialSessionData) }
    });
  }
}

/**
 * Updates a sessionBillLine document with new values.
 * Uses a transaction to ensure safe updates.
 */
export async function updateSessionBillLine(
  storeId: string,
  sessionId: string,
  lineId: string,
  patch: Partial<SessionBillLine>,
  user: AppUser
) {
  if (!storeId || !sessionId || !lineId) {
    throw new Error('Missing storeId, sessionId, or lineId');
  }

  const lineRef = doc(db, 'stores', storeId, 'sessions', sessionId, 'sessionBillLines', lineId);
  const actor = getActorStamp(user);

  const updatePayload = {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedByUid: actor.uid,
    updatedByName: actor.username,
  };

  await updateDoc(lineRef, updatePayload);
}

export async function removeLineAdjustment(
  storeId: string,
  sessionId: string,
  lineId: string,
  adjId: string,
  user: AppUser
) {
  if (!storeId || !sessionId || !lineId || !adjId) {
    throw new Error("Missing required IDs to remove line adjustment.");
  }

  const lineRef = doc(db, 'stores', storeId, 'sessions', sessionId, 'sessionBillLines', lineId);
  const actor = getActorStamp(user);

  const updatePayload = {
    [`lineAdjustments.${adjId}`]: deleteField(),
    updatedAt: serverTimestamp(),
    updatedByUid: actor.uid,
    updatedByName: actor.username,
  };

  await updateDoc(lineRef, updatePayload);
}

type Writer =
  | { kind: "tx"; tx: Transaction }
  | { kind: "batch"; batch: WriteBatch };

/**
 * Helper to create kitchen tickets for addon/refill items.
 * Can be used within a transaction or standalone.
 */
export async function createKitchenTickets(
  db: Firestore,
  storeId: string,
  sessionId: string,
  session: PendingSession,
  type: OrderItemType,
  line: { itemId: string; itemName: string; kitchenLocationId: string; kitchenLocationName?: string | null; billLineId: string | null },
  qty: number,
  actor: ActorStamp,
  opts: { tx: Transaction },
  notes?: string
) {
  const ticketsColRef = collection(db, `stores/${storeId}/sessions/${sessionId}/kitchentickets`);
  const now = Date.now();
  const serverTs = serverTimestamp();
  
  const w: Writer = { kind: "tx", tx: opts.tx };
  const stationId = line.kitchenLocationId;

  for (let i = 0; i < qty; i++) {
    const ticketRef = doc(ticketsColRef);
    const ticketPayload = stripUndefined({
      id: ticketRef.id,
      type: type,
      itemId: line.itemId,
      itemName: line.itemName,
      billLineId: line.billLineId,
      qty: 1, // Each ticket is for qty 1
      kitchenLocationId: line.kitchenLocationId,
      kitchenLocationName: line.kitchenLocationName,
      notes: notes || null,
      status: "preparing",
      createdByUid: actor.uid,
      createdAt: serverTs,
      createdAtClientMs: now,
      updatedAt: serverTs,
      sessionId: sessionId, 
      storeId,
      tableNumber: session.tableNumber,
      tableDisplayName: session.tableDisplayName,
      customerName: session.customer?.name || session.customerName,
      sessionMode: session.sessionMode,
      sessionLabel: computeSessionLabel(session),
      guestCount: session.guestCountFinal || session.guestCountCashierInitial,
    });

    w.tx.set(ticketRef, ticketPayload);
    
    if (stationId) {
        const rtKdsDocRef = doc(db, "stores", storeId, "rtKdsTickets", stationId);
        w.tx.set(rtKdsDocRef, { meta: { source: 'createKitchenTickets', updatedAt: serverTimestamp() }, kitchenLocationId: stationId }, { merge: true });
        w.tx.update(rtKdsDocRef, {
            [`tickets.${ticketRef.id}`]: ticketPayload,
            activeIds: arrayUnion(ticketRef.id),
            [`sessionIndex.${sessionId}`]: arrayUnion(ticketRef.id)
        });
    }
  }
}
