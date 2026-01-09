
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
  query,
  where,
  type Transaction,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { AppUser } from '@/context/auth-context';
import type { Store, StorePackage, BillableLine, Payment, ModeOfPayment, StoreAddon, ActivityLog } from '@/lib/types';
import { stripUndefined } from '@/lib/firebase/utils';
import { computeSessionLabel } from '@/lib/utils/session';
import { normalizeKey } from './billable-lines';
import { writeActivityLog } from './activity-log';
import type { TaxAndTotals } from '@/lib/tax';

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
 * Creates session doc, table update, and initial kitchen/billing units.
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
    startedAtClientMs: Date.now(), // Added client-side timestamp
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
  
  // 3. For package dine-in, create packageUnits and one operational kitchen ticket
  if (payload.sessionMode === 'package_dinein' && payload.package) {
      const stationKey = payload.package.kitchenLocationId;
      if (!stationKey) {
          throw new Error(`Package with ID ${payload.package.packageId} does not have a kitchen location assigned.`);
      }
      
      // Create billable guest units
      const packageUnitsRef = collection(db, "stores", storeId, "sessions", newSessionRef.id, "packageUnits");
      for (let i = 0; i < payload.guestCount; i++) {
        const guestId = `guest-${String(i+1).padStart(3, '0')}`;
        const unitRef = doc(packageUnitsRef, guestId);
        batch.set(unitRef, {
          guestId,
          packageId: payload.package.packageId,
          packageName: payload.package.packageName,
          unitPrice: payload.package.pricePerHead,
          createdAt: serverTimestamp(),
          billing: {
            isFree: false,
          }
        });
      }

      // Create one operational kitchen ticket
      const ticketRef = doc(collection(db, "stores", storeId, "sessions", newSessionRef.id, "kitchentickets"));
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
 * Completes a payment and closes the dining session idempotently using individual billing units.
 * Uses a Firestore transaction to ensure atomicity.
 */
export async function completePaymentFromUnits(
  storeId: string,
  sessionId: string,
  user: AppUser,
  payments: Payment[],
  billableUnits: any[], // Type is now 'any' because it's just for analytics
  billingSummary: TaxAndTotals,
  paymentMethods: ModeOfPayment[]
) {
  const addonMap = new Map<string, StoreAddon>();
  const addonIds = billableUnits.filter(b => b.type === 'addon' && b.itemId).map(b => b.itemId!);
  const uniqueAddonIds = [...new Set(addonIds)];

  if (uniqueAddonIds.length > 0) {
      const idChunks = [];
      for (let i = 0; i < uniqueAddonIds.length; i += 30) {
          idChunks.push(uniqueAddonIds.slice(i, i + 30));
      }

      for (const chunk of idChunks) {
          const addonQuery = query(collection(db, `stores/${storeId}/storeAddons`), where('id', 'in', chunk));
          const addonSnaps = await getDocs(addonQuery);
          addonSnaps.forEach(snap => {
              if (snap.exists()) {
                  addonMap.set(snap.id, snap.data() as StoreAddon);
              }
          });
      }
  }

  let receiptId: string = "";

  await runTransaction(db, async (tx) => {
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

    if (!sessionSnap.exists()) throw new Error(`Session ${sessionId} does not exist.`);
    
    const sessionData = sessionSnap.data();
    if (sessionData.status === "closed" || sessionData.isPaid === true) {
      console.warn(`Payment completion skipped: Session ${sessionId} is already closed.`);
      receiptId = receiptRef.id;
      return;
    }
    
    let tableRef = null;
    let tableSnap = null;
    if (sessionData.tableId && sessionData.tableId !== 'alacarte') {
        tableRef = doc(db, `stores/${storeId}/tables`, sessionData.tableId);
        tableSnap = await tx.get(tableRef);
    }
    
    const { grandTotal } = billingSummary;
    const totalPaid = payments.reduce((s, p) => s + (typeof p.amount === "number" ? p.amount : Number(p.amount) || 0), 0);

    if (totalPaid < grandTotal) throw new Error("Cannot complete payment: balance is not zero.");

    const actor = getActorStamp(user);
    const shouldCreateReceipt = !receiptSnap.exists();

    const paymentsCol = collection(db, `stores/${storeId}/sessions`, sessionId, "payments");
    payments.forEach((payment) => {
      const paymentRef = doc(paymentsCol);
      tx.set(paymentRef, {
          ...payment,
          id: paymentRef.id,
          createdByUid: actor.uid,
          createdByUsername: actor.username,
          createdAt: serverTimestamp(),
      });
    });

    tx.update(sessionRef, {
        status: "closed",
        isPaid: true,
        closedByUid: actor.uid,
        closedByUsername: actor.username,
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
        const analyticsV2 = {
          v: 2,
          sessionStartedAt: sessionData.startedAt ?? sessionData.createdAt ?? null,
          sessionStartedAtClientMs: sessionData.startedAtClientMs ?? null,
          subtotal: billingSummary.subtotal,
          discountsTotal: billingSummary.totalDiscounts,
          chargesTotal: billingSummary.chargesTotal,
          taxAmount: billingSummary.taxTotal,
          grandTotal: billingSummary.grandTotal,
          totalPaid: totalPaid,
          change: Math.max(0, totalPaid - grandTotal),
          mop: payments.reduce((acc, p) => {
              const key = paymentMethods.find(pm => pm.id === p.methodId)?.name || p.methodId || "unknown";
              const amt = typeof p.amount === 'number' ? p.amount : Number(p.amount) || 0;
              acc[key] = (acc[key] || 0) + amt;
              return acc;
          }, {} as Record<string, number>),
          // salesByCategory and salesByItem are now computed in the billingSummary
          salesByCategory: {}, // This will be calculated in a more advanced analytics model
          salesByItem: {}, // This will be calculated in a more advanced analytics model
          servedRefillsByName: sessionData.servedRefillsByName || {},
          serveCountByType: sessionData.serveCountByType || {},
          serveTimeMsTotalByType: sessionData.serveTimeMsTotalByType || {},
        };

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
            change: Math.max(0, totalPaid - grandTotal),
            status: "final",
            receiptSeq: nextSeq,
            receiptNumber,
            receiptNoFormatUsed: receiptNoFormat,
            analytics: analyticsV2,
        });

        tx.set(receiptRef, {
            ...receiptPayload,
            createdAt: serverTimestamp(),
            createdAtClientMs: Date.now(),
        });
        receiptId = receiptRef.id;
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

  if (receiptId) {
     await writeActivityLog({
        storeId,
        sessionId,
        user,
        action: "PAYMENT_COMPLETED",
        note: "Payment completed",
        meta: {
            receiptId,
            receiptNumber: receiptId, // Placeholder until we can get it back from tx
            paymentTotal: grandTotal,
        }
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
  const sessionRef = doc(db, "stores", storeId, "sessions", sessionId);
  const sessionDoc = await getDoc(sessionRef);

  if (!sessionDoc.exists()) {
    throw new Error("Session not found.");
  }

  const sessionData = sessionDoc.data();
  if (sessionData.status === "closed" || sessionData.status === "voided" || sessionData.isPaid) {
    throw new Error("Session is already finalized and cannot be voided.");
  }

  const batch = writeBatch(db);

  // 1. Update session doc
  batch.update(sessionRef, {
    status: "voided",
    voidedAt: serverTimestamp(),
    voidedByUid: actor.uid,
    voidedByUsername: getActorStamp(actor).username,
    voidReason: reason,
    updatedAt: serverTimestamp(),
  });

  // 2. Free up table if applicable
  if (sessionData.tableId && sessionData.tableId !== "alacarte") {
    const tableRef = doc(db, "stores", storeId, "tables", sessionData.tableId);
    batch.update(tableRef, {
      status: "available",
      currentSessionId: null,
      updatedAt: serverTimestamp(),
    });
  }

  // 3. Cancel outstanding kitchen tickets
  const ticketsRef = collection(db, "stores", storeId, "sessions", sessionId, "kitchentickets");
  const ticketsQuery = query(ticketsRef, where("status", "in", ["preparing", "ready"]));
  const ticketsSnap = await getDocs(ticketsQuery);
  ticketsSnap.forEach(ticketDoc => {
    batch.update(ticketDoc.ref, {
      status: "cancelled",
      cancelReason: "SESSION_VOIDED",
      cancelledAt: serverTimestamp(),
      cancelledByUid: actor.uid,
      updatedAt: serverTimestamp(),
    });
  });
  
  await batch.commit();
}

  
