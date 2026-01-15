
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
  type DocumentReference,
  type CollectionReference,
  increment,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { AppUser } from '@/context/auth-context';
import type { Store, StorePackage, Payment, ModeOfPayment, InventoryItem, ActivityLog, SessionBillLine, Discount, Adjustment, ReceiptAnalyticsV2, Receipt } from '@/lib/types';
import { stripUndefined } from '@/lib/firebase/utils';
import { computeSessionLabel } from '@/lib/utils/session';
import { writeActivityLog } from './activity-log';
import type { TaxAndTotals } from '@/lib/tax';
import { calculateBillTotals } from '@/lib/tax';
import { getDayIdFromTimestamp, dailyAnalyticsDocRef, getGuestCoversContribution, getSalesContribution, getPeakHourContribution, getRefillContribution, getClosedSessionsContribution } from "@/lib/analytics/daily";
import { v4 as uuidv4 } from "uuid";
import { applyAnalyticsDeltaV2 } from '@/lib/analytics/applyAnalyticsDeltaV2';

type ActorStamp = { uid: string; username: string; email?: string | null };

export function getActorStamp(user: AppUser): ActorStamp {
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
  
  // 3. For package dine-in, create a sessionBillLine for the package
  if (payload.sessionMode === 'package_dinein' && payload.package) {
      const lineId = `package_${payload.package.packageId}`;
      const lineRef = doc(db, `stores/${storeId}/sessions/${newSessionRef.id}/sessionBillLines`, lineId);
      
      batch.set(lineRef, {
        id: lineId,
        type: "package",
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
        updatedByName: getActorStamp(user).username
      });
      
      const stationKey = payload.package.kitchenLocationId;
      if (!stationKey) {
          throw new Error(`Package with ID ${payload.package.packageId} does not have a kitchen location assigned.`);
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
        itemId: payload.package.packageId, // Link to billable item
        itemName: payload.package.packageName,
        guestCount: payload.guestCount,
        status: "preparing",
        kitchenLocationId: stationKey,
        kitchenLocationName: payload.package.kitchenLocationName,
        notes: payload.notes || "",
        qty: 1, // The package itself is one unit
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
        sessionMode: 'package_dinein',
        customerName: payload.customer?.name,
        sessionLabel: sessionLabel,
      });
      batch.set(ticketRef, ticketPayload);
  }


  await batch.commit();

  await writeActivityLog({
    storeId,
    sessionId: newSessionRef.id,
    user,
    action: "SESSION_STARTED",
    note: "Session started",
  });

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
  let receiptId: string = "";
  let finalReceipt: Receipt | null = null;

  // Recalculate totals inside the transaction function to ensure consistency
  const finalTotals = calculateBillTotals(billLines, store, billDiscount, customAdjustments);
  const amountDue = finalTotals.grandTotal;
  const now = Date.now();
  
  await runTransaction(db, async (tx) => {
    const sessionRef = doc(db, `stores/${storeId}/sessions`, sessionId);
    const settingsRef = doc(db, `stores/${storeId}/receiptSettings`, "main");
    const counterRef = doc(db, `stores/${storeId}/counters`, "receipts");
    const receiptRef = doc(db, `stores/${storeId}/receipts`, sessionId);
    
    const [sessionSnap, receiptSnap] = await Promise.all([
      tx.get(sessionRef),
      tx.get(receiptRef),
    ]);

    if (!sessionSnap.exists()) throw new Error(`Session ${sessionId} does not exist.`);
    
    // Idempotency Guard: Check if analytics have already been applied for this session.
    if (receiptSnap.exists() && receiptSnap.data()?.analyticsApplied) {
      console.warn(`Payment completion skipped: Analytics for session ${sessionId} already applied.`);
      receiptId = receiptRef.id;
      return;
    }
    
    const sessionData = sessionSnap.data();
    if (sessionData.status === "closed" || sessionData.isPaid === true) {
      console.warn(`Payment completion skipped: Session ${sessionId} is already closed.`);
      receiptId = receiptSnap.exists() ? receiptSnap.id : "";
      return;
    }
    
    // Gating for Ala Carte
    if (sessionData.sessionMode === 'alacarte') {
        const billedAddonQty = billLines
            .filter(line => line.type === 'addon')
            .reduce((sum, line) => sum + Math.max(0, line.qtyOrdered - line.voidedQty - line.freeQty), 0);
        if (billedAddonQty <= 0) {
            throw new Error("Ala carte session requires at least one billable item.");
        }
    }
    
    let tableRef = null;
    let tableSnap = null;
    if (sessionData.tableId && sessionData.tableId !== 'alacarte') {
        tableRef = doc(db, `stores/${storeId}/tables`, sessionData.tableId);
        tableSnap = await tx.get(tableRef);
    }
    
    const totalPaid = payments.reduce((s, p) => s + (typeof p.amount === "number" ? p.amount : Number(p.amount) || 0), 0);

    if (totalPaid < amountDue) throw new Error("Cannot complete payment: balance is not zero.");

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
        closedAtClientMs: now,
        updatedAt: serverTimestamp(),
    });

    if (shouldCreateReceipt) {
        const settingsSnap = await tx.get(settingsRef);
        const counterSnap = await tx.get(counterRef);

        const receiptNoFormat = settingsSnap.exists() ? (settingsSnap.data()?.receiptNoFormat ?? "SELIP-######") : "SELIP-######";
        const currentSeq = counterSnap.exists() ? Number(counterSnap.data()?.seq ?? 0) : 0;
        const nextSeq = currentSeq + 1;
        
        tx.set(counterRef, { seq: nextSeq, updatedAt: serverTimestamp() }, { merge: true });
        
        const receiptNumber = formatReceiptNumber(receiptNoFormat, nextSeq);
        const change = Math.max(0, totalPaid - amountDue);
        
        const mopMap: Record<string, number> = {};
        payments.forEach(p => {
            const method = paymentMethods.find(m => m.id === p.methodId);
            const key = method?.name || p.methodId || "unknown";
            mopMap[key] = (mopMap[key] || 0) + p.amount;
        });
        
        const receiptPayload: Omit<Receipt, 'createdAt'> = stripUndefined({
            id: sessionId,
            storeId,
            sessionId,
            createdByUid: actor.uid,
            createdByUsername: actor.username,
            sessionMode: sessionData.sessionMode,
            tableId: sessionData.sessionMode === 'alacarte' ? null : sessionData.tableId ?? null,
            tableNumber: sessionData.sessionMode === 'alacarte' ? null : sessionData.tableNumber ?? null,
            customerName: sessionData.customer?.name ?? sessionData.customerName ?? null,
            total: amountDue,
            totalPaid,
            change: Math.max(0, totalPaid - amountDue),
            status: "final",
            receiptSeq: nextSeq,
            receiptNumber,
            receiptNoFormatUsed: receiptNoFormat,
            createdAtClientMs: Date.now(),
            lines: billLines,
        } as Omit<Receipt, 'createdAt'>);
        
        const salesAnalytics = billLines.reduce(
            (acc, line) => {
                if (line.type !== 'package' && line.type !== 'addon') return acc;
                
                const netQty = Math.max(0, line.qtyOrdered - (line.freeQty || 0) - (line.voidedQty || 0));
                if (netQty <= 0) return acc;

                const grossAmount = netQty * line.unitPrice;
                const discountQty = Math.min(line.discountQty || 0, netQty);
                
                let discountAmount = 0;
                if (discountQty > 0) {
                    const discountBaseUnit = (store.taxType === 'VAT_INCLUSIVE' && store.taxRatePct && store.taxRatePct > 0)
                        ? (line.unitPrice / (1 + (store.taxRatePct / 100)))
                        : line.unitPrice;

                    if (line.discountType === 'percent') {
                        discountAmount = (discountQty * discountBaseUnit) * ((line.discountValue || 0) / 100);
                    } else { // fixed
                        discountAmount = Math.min(discountBaseUnit, (line.discountValue ?? 0)) * discountQty;
                    }
                }
                const netAmount = grossAmount - discountAmount;
                
                const categoryName = line.category || 'Uncategorized';
                
                acc.salesByItem ??= {};
                acc.salesByCategory ??= {};
                
                if (!acc.salesByItem[line.itemName]) {
                    acc.salesByItem[line.itemName] = { qty: 0, amount: 0, categoryName };
                }
                acc.salesByItem[line.itemName].qty += netQty;
                acc.salesByItem[line.itemName].amount += netAmount;
                
                if (!acc.salesByCategory[categoryName]) {
                    acc.salesByCategory[categoryName] = { qty: 0, amount: 0 };
                }
                acc.salesByCategory[categoryName].qty += netQty;
                acc.salesByCategory[categoryName].amount += netAmount;

                return acc;
            },
            {} as {
                salesByItem?: ReceiptAnalyticsV2['salesByItem'];
                salesByCategory?: ReceiptAnalyticsV2['salesByCategory'];
            }
        );
        
        const startedDate = new Date(sessionData.startedAtClientMs);
        const sessionStartedAtHour = startedDate.getHours();
        
        let guestCountSnapshot: ReceiptAnalyticsV2["guestCountSnapshot"] | undefined = undefined;
        if (sessionData.sessionMode === 'package_dinein') {
            const cashierInitial = sessionData.guestCountCashierInitial ?? 0;
            const serverVerified = sessionData.guestCountServerVerified ?? 0;
            const finalGuestCount = sessionData.guestCountFinal ?? Math.max(cashierInitial, serverVerified);

            const pkgLine = billLines.find(l => l.type === 'package');
            const billedPackageCovers = Math.max(0, (pkgLine?.qtyOrdered ?? 0) - (pkgLine?.voidedQty ?? 0) - (pkgLine?.freeQty ?? 0));
            const discrepancy = billedPackageCovers - finalGuestCount;
            
            const packageOfferingId = sessionData.packageOfferingId ?? null;
            const packageName = sessionData.packageSnapshot?.name ?? pkgLine?.itemName ?? null;

            guestCountSnapshot = {
                packageOfferingId,
                packageName,
                finalGuestCount,
                billedPackageCovers,
                discrepancy,
                computedAtClientMs: Date.now(),
                rule: "MAX",
            };
        }
        
        const applyId = uuidv4();
        const analyticsV2: ReceiptAnalyticsV2 = {
          v: 2,
          sessionStartedAt: sessionData.startedAt ?? sessionData.createdAt ?? null,
          sessionStartedAtClientMs: sessionData.startedAtClientMs ?? null,
          sessionStartedAtHour: sessionStartedAtHour,
          subtotal: finalTotals.subtotal,
          discountsTotal: finalTotals.totalDiscounts,
          chargesTotal: finalTotals.chargesTotal,
          taxAmount: finalTotals.taxTotal,
          grandTotal: finalTotals.grandTotal,
          totalPaid: totalPaid,
          change: change,
          mop: mopMap,
          salesByItem: salesAnalytics.salesByItem,
          salesByCategory: salesAnalytics.salesByCategory,
          addonSalesByItem: {}, // Placeholder, to be populated if needed
          servedRefillsByName: sessionData.servedRefillsByName || {},
          serveCountByType: sessionData.serveCountByType || {},
          serveTimeMsTotalByType: sessionData.serveTimeMsTotalByType || {},
          guestCountSnapshot,
        };
        
        const finalReceiptPayload = { 
            ...receiptPayload, 
            analytics: analyticsV2, 
            createdAt: serverTimestamp(),
            analyticsApplied: true,
            analyticsAppliedAt: serverTimestamp(),
            analyticsApplyId: applyId,
        };
        tx.set(receiptRef, finalReceiptPayload);
        finalReceipt = finalReceiptPayload as Receipt;
        
        await applyAnalyticsDeltaV2(db, storeId, null, finalReceipt, { tx });
        
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
            receiptNumber: finalReceipt?.receiptNumber,
            paymentTotal: amountDue,
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


/**
 * Updates a sessionBillLine document with new values.
 * Uses a transaction to ensure safe updates.
 */
export async function updateSessionBillLine(
    storeId: string,
    sessionId: string,
    lineId: string,
    patch: Partial<SessionBillLine>,
    user: AppUser,
) {
    if (!storeId || !sessionId || !lineId) {
        throw new Error("Missing storeId, sessionId, or lineId");
    }

    const lineRef = doc(db, "stores", storeId, "sessions", sessionId, "sessionBillLines", lineId);
    const actor = getActorStamp(user);

    // Make sure to include the update timestamp.
    const updatePayload = {
        ...patch,
        updatedAt: serverTimestamp(),
        updatedByUid: actor.uid,
        updatedByName: actor.username,
    };

    await updateDoc(lineRef, updatePayload);
}
