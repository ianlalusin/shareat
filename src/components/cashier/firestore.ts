

'use client';

import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
  addDoc,
  Timestamp,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { AppUser } from '@/context/auth-context';
import type { StorePackage, BillableItem } from '@/lib/types';
import type { Payment, ModeOfPayment } from '@/lib/types';
import { stripUndefined } from '@/lib/firebase/utils';
import { computeSessionLabel } from '@/lib/utils/session';

type ActorStamp = { uid: string; username: string; email?: string | null };

function getActorStamp(user: AppUser): ActorStamp {
  const username =
    (user.displayName && user.displayName.trim()) ||
    ((user as any).name && String((user as any).name).trim()) ||
    (user.email ? user.email.split("@")[0] : "") ||
    user.uid.slice(0, 6);

  return { uid: user.uid, username, email: user.email ?? null };
}

export type StartSessionPayload = {
  tableId: string;
  tableNumber: string;
  guestCount: number;
  customer?: { name?: string | null; tin?: string | null; address?: string | null };
  notes?: string;
  initialFlavorIds?: string[];
  package?: StorePackage; // Optional for ala carte
  sessionMode: 'package_dinein' | 'alacarte';
};

/**
 * Formats a receipt number based on a template and a sequence number.
 * @param fmt The format string (e.g., "PREFIX-#####").
 * @param seq The sequence number.
 * @returns The formatted receipt number string.
 */
function formatReceiptNumber(fmt: string, seq: number): string {
  // Find the longest run of '#' characters to determine padding.
  const m = fmt.match(/#+/g);
  if (!m) {
    // If no hash marks, just append the sequence number.
    return `${fmt}${seq}`;
  }
  const run = m.sort((a, b) => b.length - a.length)[0];
  const padded = String(seq).padStart(run.length, "0");
  return fmt.replace(run, padded);
}


/**
 * Starts a new dining session.
 * Creates session doc, table update, initial package billable, and initial kitchen ticket.
 */
export async function startSession(
  storeId: string,
  payload: StartSessionPayload,
  user: AppUser
) {
  const batch = writeBatch(db);

  // 1. Create a new session document
  const newSessionRef = doc(collection(db, `stores/${storeId}/sessions`));
  
  const isAlaCarte = payload.sessionMode === 'alacarte';
  const customerName = payload.customer?.name ?? null;
  const tableNumber = isAlaCarte ? null : payload.tableNumber;
  const sessionLabel = computeSessionLabel({ sessionMode: payload.sessionMode, customerName, tableNumber });


  const sessionPayload = stripUndefined({
    id: newSessionRef.id,
    storeId: storeId,
    tableId: payload.tableId,
    tableNumber: tableNumber,
    customerName: customerName,
    sessionLabel: sessionLabel,
    status: isAlaCarte ? 'active' : 'pending_verification',
    sessionMode: payload.sessionMode,
    isPaid: false,
    startedAt: serverTimestamp(),
    startedByUid: user.uid,
    
    // Guest Count Model
    guestCountCashierInitial: payload.guestCount,
    guestCountServerVerified: null,
    guestCountFinal: isAlaCarte ? null : payload.guestCount, // Initially set to cashier's count for package
    guestCountVerifyLocked: isAlaCarte, // Lock immediately for ala carte

    verifiedAt: null,
    verifiedByUid: null,
    packageOfferingId: payload.package?.packageId || null,
    packageSnapshot: payload.package ? {
      name: payload.package.packageName,
      pricePerHead: payload.package.pricePerHead,
    } : null,
    initialFlavorIds: payload.initialFlavorIds || [],
    customer: payload.customer,
    notes: payload.notes || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(newSessionRef, sessionPayload);

  // 2. Update the existing table document if it's not an ala carte session
  if (!isAlaCarte) {
    const tableRef = doc(db, `stores/${storeId}/tables`, payload.tableId);
    batch.update(tableRef, {
      status: 'occupied',
      currentSessionId: newSessionRef.id,
      updatedAt: serverTimestamp(),
    });
  }
  
  // 3. For package dine-in, create initial billable and kitchen ticket
  if (payload.sessionMode === 'package_dinein' && payload.package) {
      const stationKey = payload.package.kitchenLocationId;
      if (!stationKey) {
          throw new Error(`Package with ID ${payload.package.packageId} does not have a kitchen location assigned.`);
      }
      
      const ticketRef = doc(collection(db, "stores", storeId, "sessions", newSessionRef.id, "kitchentickets"));
      const billableRef = doc(collection(db, "stores", storeId, "sessions", newSessionRef.id, "billables"), ticketRef.id);
      
      const billablePayload = stripUndefined({
          id: ticketRef.id,
          source: "kitchenticket",
          type: "package",
          itemName: payload.package.packageName,
          qty: payload.guestCount,
          unitPrice: payload.package.pricePerHead,
          lineDiscountType: "fixed",
          lineDiscountValue: 0,
          isFree: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdByUid: user.uid,
      });
      batch.set(billableRef, billablePayload);

      const ticketPayload = stripUndefined({
        id: ticketRef.id,
        sessionId: newSessionRef.id,
        storeId: storeId,
        tableId: payload.tableId,
        tableNumber: payload.tableNumber,
        type: "package",
        itemName: payload.package.packageName,
        guestCount: payload.guestCount,
        status: "preparing",
        kitchenLocationId: stationKey,
        kitchenLocationName: payload.package.kitchenLocationName,
        notes: payload.notes || "",
        qty: 1, // The package itself is one unit
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
        preparedByUid: null, preparedAt: null,
        servedByUid: null, servedAt: null,
        cancelledByUid: null, cancelledAt: null,
        cancelReason: null,
        sessionMode: 'package_dinein',
        customerName: payload.customer?.name,
        sessionLabel: sessionLabel,
      });
      batch.set(ticketRef, ticketPayload);
  }


  await batch.commit();
  return newSessionRef.id;
}


/**
 * Updates a billable item and records the change in the bill history.
 */
export async function updateBillableItem(
    storeId: string,
    sessionId: string,
    itemId: string,
    updateData: Partial<Omit<BillableItem, 'id'>>,
    originalData: BillableItem,
    user: AppUser,
) {
    const batch = writeBatch(db);

    // 1. Update the billable item
    const itemRef = doc(db, "stores", storeId, "sessions", sessionId, "billables", itemId);
    batch.update(itemRef, stripUndefined({...updateData, updatedAt: serverTimestamp()}));

    // 2. Record the change in history
    const historyRef = collection(db, "stores", storeId, "sessions", sessionId, "billHistory");
    const changedFields = Object.keys(updateData).filter(key => 
        JSON.stringify(updateData[key as keyof typeof updateData]) !== JSON.stringify(originalData[key as keyof typeof originalData])
    );

    if (changedFields.length > 0) {
        const before: Record<string, any> = {};
        const after: Record<string, any> = {};
        changedFields.forEach(key => {
            before[key] = originalData[key as keyof typeof originalData];
            after[key] = updateData[key as keyof typeof updateData];
        });

        const newHistoryRef = doc(historyRef);
        batch.set(newHistoryRef, stripUndefined({
            id: newHistoryRef.id,
            lineId: itemId,
            action: "update",
            before,
            after,
            performedByUid: user.uid,
            createdAt: serverTimestamp(),
        }));
    }

    await batch.commit();
}


/**
 * Updates the status of a kitchen ticket. This is the primary action for cashier overrides.
 */
export async function updateKitchenTicketStatus(
    storeId: string,
    sessionId: string,
    ticketId: string,
    newStatus: 'served' | 'void' | 'cancelled',
    user: AppUser,
    reason?: string
) {
    const batch = writeBatch(db);

    // 1. Update the kitchen ticket - this is the source of truth
    const ticketRef = doc(db, "stores", storeId, "sessions", sessionId, "kitchentickets", ticketId);
    const ticketUpdate: any = { status: newStatus };
    
    if (newStatus === 'served') {
        ticketUpdate.servedAt = serverTimestamp();
        ticketUpdate.servedByUid = user.uid;
    } else { // 'void' or 'cancelled'
        ticketUpdate.cancelledAt = serverTimestamp();
        ticketUpdate.cancelledByUid = user.uid;
        ticketUpdate.cancelReason = reason || 'Voided by cashier';
    }
    batch.update(ticketRef, stripUndefined(ticketUpdate));

    // 2. Log the activity
    const logRef = doc(collection(db, "stores", storeId, "activityLogs"));
    batch.set(logRef, stripUndefined({
        type: 'cashier_ticket_override',
        action: newStatus,
        sessionId,
        ticketId: ticketId,
        performedByUid: user.uid,
        reason: reason || null,
        createdAt: serverTimestamp()
    }));

    await batch.commit();
}

type BillingSummary = {
  subtotal: number;
  lineDiscountsTotal: number;
  billDiscountAmount: number;
  adjustmentsTotal: number;
  grandTotal: number;
}


/**
 * Completes a payment and closes the dining session idempotently.
 * Uses a Firestore transaction to ensure atomicity and prevent race conditions.
 */
export async function completePayment(
  storeId: string,
  sessionId: string,
  user: AppUser,
  payments: Payment[],
  billingSummary: BillingSummary,
  paymentMethods: ModeOfPayment[]
) {
  await runTransaction(db, async (tx) => {
    // --- READ PHASE ---
    const sessionRef = doc(db, `stores/${storeId}/sessions`, sessionId);
    const receiptRef = doc(db, `stores/${storeId}/receipts`, sessionId);
    const settingsRef = doc(db, `stores/${storeId}/receiptSettings`, "main");
    const counterRef = doc(db, `stores/${storeId}/counters`, "receipts");

    const [sessionSnap, receiptSnap, settingsSnap, counterSnap] = await Promise.all([
        tx.get(sessionRef),
        tx.get(receiptRef),
        tx.get(settingsRef),
        tx.get(counterRef),
    ]);

    if (!sessionSnap.exists()) {
      throw new Error(`Session ${sessionId} does not exist.`);
    }
    
    const sessionData = sessionSnap.data();
    if (sessionData.status === "closed" || sessionData.isPaid === true) {
      console.warn(`Payment completion skipped: Session ${sessionId} is already closed.`);
      return; // Idempotent no-op
    }
    
    let tableRef = null;
    let tableSnap = null;
    if (sessionData.tableId && sessionData.tableId !== 'alacarte') {
        tableRef = doc(db, `stores/${storeId}/tables`, sessionData.tableId);
        tableSnap = await tx.get(tableRef);
    }
    
    // --- VALIDATION AND PREPARATION ---
    const grandTotal = billingSummary.grandTotal || 0;
    const totalPaid = payments.reduce((s, p) => s + (typeof p.amount === "number" ? p.amount : Number(p.amount) || 0), 0);

    if (totalPaid < grandTotal) {
      throw new Error("Cannot complete payment: balance is not zero.");
    }
    const actor = getActorStamp(user);
    const shouldCreateReceipt = !receiptSnap.exists();

    // --- WRITE PHASE ---
    const paymentsCol = collection(db, `stores/${storeId}/sessions`, sessionId, "payments");
    payments.forEach((payment) => {
      const paymentRef = doc(paymentsCol);
      const paymentPayload = stripUndefined({
        ...payment,
        id: paymentRef.id,
        createdByUid: actor.uid,
        createdByUsername: actor.username,
      });
      tx.set(paymentRef, {
          ...paymentPayload,
          createdAt: serverTimestamp(),
      });
    });

    const sessionUpdatePayload = stripUndefined({
      status: "closed",
      isPaid: true,
      closedByUid: actor.uid,
      closedByUsername: actor.username,
      paymentSummary: {
        ...billingSummary,
        totalPaid,
        change: Math.max(0, totalPaid - grandTotal),
        payments,
      },
    });

    tx.update(sessionRef, {
        ...sessionUpdatePayload,
        closedAt: serverTimestamp(),
        closedAtClientMs: Date.now(),
        updatedAt: serverTimestamp(),
    });

    if (shouldCreateReceipt) {
        const receiptNoFormat = settingsSnap.exists() ? (settingsSnap.data()?.receiptNoFormat ?? "SELIP-######") : "SELIP-######";
        const currentSeq = counterSnap.exists() ? Number(counterSnap.data()?.seq ?? 0) : 0;
        const nextSeq = currentSeq + 1;
        
        tx.set(counterRef, { seq: nextSeq, updatedAt: serverTimestamp() }, { merge: true });
        
        const receiptNumber = formatReceiptNumber(receiptNoFormat, nextSeq);

        const discountsTotal = (billingSummary.lineDiscountsTotal || 0) + (billingSummary.billDiscountAmount || 0);
        const chargesTotal = billingSummary.adjustmentsTotal || 0;
        const change = Math.max(0, totalPaid - grandTotal);
        
        const mopNameMap = new Map(paymentMethods.map(m => [m.id, m.name]));
        const mop = payments.reduce((acc, p) => {
          const key = mopNameMap.get(p.methodId) || p.methodId || "unknown";
          const amt = typeof p.amount === "number" ? p.amount : Number(p.amount) || 0;
          acc[key] = (acc[key] || 0) + amt;
          return acc;
        }, {} as Record<string, number>);

        const receiptPayload = stripUndefined({
            id: sessionId,
            storeId,
            sessionId,
            createdByUid: actor.uid,
            createdByUsername: actor.username,
            sessionMode: sessionData.sessionMode,
            tableId: sessionData.sessionMode === 'alacarte' ? null : sessionData.tableId ?? null,
            tableNumber: sessionData.sessionMode === 'alacarte' ? null : sessionData.tableNumber ?? null,
            customerName: sessionData.customer?.name ?? sessionData.customerName ?? null,
            total: grandTotal,
            totalPaid,
            change: change,
            status: "final",
            receiptSeq: nextSeq,
            receiptNumber,
            receiptNoFormatUsed: receiptNoFormat,
            analytics: {
              v: 1,
              subtotal: billingSummary.subtotal || 0,
              discountsTotal,
              chargesTotal,
              taxAmount: 0,
              grandTotal,
              totalPaid,
              change,
              mop,
            }
        });

        tx.set(receiptRef, {
            ...receiptPayload,
            createdAt: serverTimestamp(),
            createdAtClientMs: Date.now(),
        });
    }

    if (tableSnap && tableRef && tableSnap.exists()) {
      const t = tableSnap.data();
      if (t.currentSessionId === sessionId) {
        tx.update(tableRef, {
          status: "available",
          currentSessionId: null,
          updatedAt: serverTimestamp(),
        });
      }
    }
  });
}
