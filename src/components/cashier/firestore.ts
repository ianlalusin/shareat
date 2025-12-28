
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
import { BillableItem } from './billable-items';
import { Payment } from './payment-section';
import type { StorePackage } from '../manager/store-settings/store-packages-settings';
import { stripUndefined } from '@/lib/firebase/utils';

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

  const sessionPayload = stripUndefined({
    id: newSessionRef.id,
    storeId: storeId,
    tableId: payload.tableId,
    tableNumber: payload.tableNumber,
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
  tableId: string, // Fallback tableId from the client
  user: AppUser,
  payments: Payment[],
  billingSummary: BillingSummary,
) {
  await runTransaction(db, async (tx) => {
    const sessionRef = doc(db, `stores/${storeId}/sessions`, sessionId);
    const snap = await tx.get(sessionRef);

    if (!snap.exists()) {
      throw new Error(`Session ${sessionId} does not exist.`);
    }

    const data = snap.data();
    if (data.status === "closed" || data.isPaid === true) {
      console.warn(`Payment completion skipped: Session ${sessionId} is already closed.`);
      return; // Idempotent no-op
    }

    // Use tableId from session data for safety, with a fallback to the client-provided one.
    const sessionTableId = data.tableId ?? tableId;
    
    // For 'alacarte' sessions, tableId might be 'alacarte', so don't try to get a doc ref for it.
    let tableRef = null;
    let tableSnap = null;
    if (sessionTableId !== 'alacarte') {
        tableRef = doc(db, `stores/${storeId}/tables`, sessionTableId);
        tableSnap = await tx.get(tableRef);
    }


    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    // Create payment documents inside the transaction
    const paymentsCol = collection(db, `stores/${storeId}/sessions`, sessionId, "payments");
    payments.forEach((payment) => {
      const paymentRef = doc(paymentsCol);
      tx.set(paymentRef, stripUndefined({
        ...payment,
        id: paymentRef.id,
        createdAt: serverTimestamp(),
        createdByUid: user.uid,
      }));
    });

    // Close the session
    tx.update(sessionRef, stripUndefined({
      status: "closed",
      isPaid: true,
      closedAt: serverTimestamp(),
      closedByUid: user.uid,
      paymentSummary: {
        ...billingSummary,
        totalPaid,
        change: Math.max(0, totalPaid - billingSummary.grandTotal),
        payments,
      },
      updatedAt: serverTimestamp(),
    }));

    // Free table ONLY if it still points to this session and exists
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
