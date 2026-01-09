

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
import type { Store, StorePackage, BillableLine, Payment, ModeOfPayment, StoreAddon, ActivityLog } from '@/lib/types';
import { stripUndefined } from '@/lib/firebase/utils';
import { computeSessionLabel } from '@/lib/utils/session';
import { writeActivityLog } from './activity-log';
import type { TaxAndTotals } from '@/lib/tax';
import sha1 from 'js-sha1';

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
        voidedQty: 0, // Packages cannot be voided this way
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
  billLines: BillableLine[],
  billingSummary: TaxAndTotals,
  paymentMethods: ModeOfPayment[]
) {
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

/**
 * Creates or updates a sessionBillLine document for an add-on.
 * Uses a transaction to safely increment quantity if the line already exists.
 */
export async function upsertAddonToBill(
  storeId: string,
  sessionId: string,
  addon: StoreAddon,
  qtyToAdd: number,
  user: AppUser
) {
  if (!addon || !addon.id) throw new Error("Valid addon is required.");
  if (qtyToAdd <= 0) return;

  // Use a deterministic ID for the line item.
  const lineId = `addon_${addon.id}_${addon.price.toFixed(2)}`;
  const lineRef = doc(db, `stores/${storeId}/sessions/${sessionId}/sessionBillLines`, lineId);
  const actor = getActorStamp(user);

  await runTransaction(db, async (tx) => {
    const lineSnap = await tx.get(lineRef);

    if (lineSnap.exists()) {
      // Line exists, increment quantity
      tx.update(lineRef, {
        qtyOrdered: increment(qtyToAdd),
        updatedAt: serverTimestamp(),
        updatedByUid: actor.uid,
        updatedByName: actor.username,
      });
    } else {
      // Line doesn't exist, create it
      const productSnap = await getDoc(doc(db, "products", addon.id));
      const productData = productSnap.data();

      const newLine: Omit<BillableLine, "id" | "createdAt"> = {
        type: "addon",
        itemId: addon.id,
        itemName: addon.name,
        category: productData?.subCategory ?? null,
        barcode: productData?.barcode ?? null,
        unitPrice: addon.price,
        qtyOrdered: qtyToAdd,
        discountType: null,
        discountValue: 0,
        discountQty: 0,
        freeQty: 0,
        voidedQty: 0,
        updatedAt: serverTimestamp(),
        updatedByUid: actor.uid,
        updatedByName: actor.username,
      };
      tx.set(lineRef, { ...newLine, id: lineRef.id, createdAt: serverTimestamp() });
    }
  });
}
  

```
</content>
  </change>
  <change>
    <file>src/components/cashier/session-detail-view.tsx</file>
    <content><![CDATA[

"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { collection, onSnapshot, query, doc, getDocs, Timestamp, orderBy, updateDoc, writeBatch, getDoc, where, serverTimestamp, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { completePaymentFromUnits, voidSession } from "@/components/cashier/firestore";
import { Loader2, History, ArrowLeft, AlertCircle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SessionHeader } from "@/components/cashier/session-header";
import { BillableItems } from "@/components/cashier/billable-items";
import { BillTotals } from "@/components/cashier/bill-totals";
import { BillAdjustments } from "@/components/cashier/bill-adjustments";
import { PaymentSection } from "@/components/cashier/payment-section";
import { CustomerInfoForm } from "@/components/cashier/customer-info-form";
import { SessionTimelineDrawer } from "@/components/session/session-timeline-drawer";
import { useConfirmDialog } from "../global/confirm-dialog";
import { writeActivityLog } from "./activity-log";
import type { KitchenTicket, ModeOfPayment, PendingSession, Payment, Charge, Discount, SessionBillLine, Store } from "@/lib/types";
import { calculateBillTotals } from "@/lib/tax";

// Validation logic remains the same
function validatePayments(payments: Payment[], grandTotal: number, paymentMethods: ModeOfPayment[]): string | null {
    if (!payments || payments.length === 0) return "Add at least one payment method.";
    for (const p of payments) {
        if (!p.methodId) return "Select a payment method.";
        if (typeof p.amount !== "number" || isNaN(p.amount) || p.amount <= 0) return "Payment amounts must be greater than zero.";
        const methodDetails = paymentMethods.find(pm => pm.id === p.methodId);
        if (methodDetails?.hasRef && (!p.reference || String(p.reference).trim().length === 0)) {
            return `Reference is required for ${methodDetails.name}.`;
        }
    }
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    if (totalPaid < grandTotal) return "Payment is not enough to cover the total.";
    return null;
}

export function SessionDetailView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { confirm, Dialog } = useConfirmDialog();

  const [session, setSession] = useState<PendingSession | null>(null);
  const [billLines, setBillLines] = useState<SessionBillLine[]>([]);
  
  const [charges, setCharges] = useState<Charge[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [billDiscount, setBillDiscount] = useState<Discount | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isCompletingPayment, setIsCompletingPayment] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const storeId = activeStore?.id;

  useEffect(() => {
    if (!storeId) return;
    const sessionRef = doc(db, "stores", storeId, "sessions", sessionId);
    const unsubscribe = onSnapshot(sessionRef, (doc) => {
        if (doc.exists()) {
            const data = doc.data();
            if ((data.status === 'closed' || data.isPaid) && router) {
                router.replace(`/receipt/${sessionId}`);
                return;
            }
            setSession({ id: doc.id, ...data } as PendingSession);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: 'Session not found.' });
            router.replace('/cashier');
        }
        setIsLoading(false);
    }, (error) => {
      console.error("Error fetching session:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not load session data.' });
      router.replace('/cashier');
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, [sessionId, storeId, router, toast]);

  useEffect(() => {
    if (!storeId) return;
    const linesQuery = query(collection(db, `stores/${storeId}/sessions/${sessionId}/sessionBillLines`), orderBy("createdAt", "asc"));
    const unsubLines = onSnapshot(linesQuery, (snapshot) => {
        setBillLines(snapshot.docs.map(d => ({id: d.id, ...d.data()} as SessionBillLine)));
    }, (e) => console.error("sessionBillLines listener failed:", e));

    return () => unsubLines();
  }, [sessionId, storeId]);


  useEffect(() => {
    if (!storeId) return;
    const unsubs: (() => void)[] = [];
    unsubs.push(onSnapshot(query(collection(db, "stores", storeId, "storeModesOfPayment"), where("isArchived", "==", false), where("isActive", "==", true), orderBy("sortOrder", "asc"), orderBy("name", "asc")), (snapshot) => {
        setPaymentMethods(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ModeOfPayment)));
    }));
    unsubs.push(onSnapshot(query(collection(db, "stores", storeId, "storeCharges"), where("isArchived", "==", false), where("isEnabled", "==", true), orderBy("sortOrder", "asc"), orderBy("name", "asc")), (snapshot) => {
        setCharges(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Charge)));
    }));
    unsubs.push(onSnapshot(query(collection(db, "stores", storeId, "storeDiscounts"), where("isArchived", "==", false), where("isEnabled", "==", true), orderBy("sortOrder", "asc"), orderBy("name", "asc")), (snapshot) => {
        setDiscounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Discount)));
    }));
    return () => unsubs.forEach(unsub => unsub());
  }, [storeId]);
  
  const billableDiscounts = useMemo(() => discounts.filter(d => d.isEnabled && !d.isArchived && d.scope?.includes("bill")), [discounts]);
  const itemDiscounts = useMemo(() => discounts.filter(d => d.isEnabled && !d.isArchived && d.scope?.includes("item")), [discounts]);
  
  const isBillingLocked = session?.status !== 'active' || session?.isPaid;

  const billTotals = useMemo(() => {
    return calculateBillTotals(billLines, activeStore as Store, billDiscount, charges);
  }, [billLines, activeStore, billDiscount, charges]);
  
  const { grandTotal } = billTotals;
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = grandTotal - totalPaid;
  const change = totalPaid > grandTotal ? totalPaid - grandTotal : 0;
  
  const canCompletePayment = grandTotal > 0 && remainingBalance <= 0;

  const handleCompletePayment = async () => {
    if (isCompletingPayment || isBillingLocked) return;

    const paymentError = validatePayments(payments, grandTotal, paymentMethods);
    if (paymentError) {
        toast({ variant: "destructive", title: "Cannot Complete", description: paymentError });
        return;
    }
    if (!canCompletePayment) {
      toast({ variant: "destructive", title: "Cannot Complete", description: "Please ensure balance is paid." });
      return;
    }
    setIsCompletingPayment(true);
    try {
        if (!appUser || !activeStore || !session) return;
        const normalizedPayments = payments.map(p => ({...p, amount: Math.round(p.amount * 100) / 100}));
        
        await completePaymentFromUnits(activeStore.id, sessionId, appUser, normalizedPayments, billLines, billTotals, paymentMethods);
        
        const settingsSnap = await getDoc(doc(db, "stores", activeStore.id, "receiptSettings", "main"));
        const autoPrint = settingsSnap.exists() && !!settingsSnap.data()?.autoPrintAfterPayment;
        toast({ title: "Payment complete", description: "Session closed successfully." });
        router.push(`/receipt/${sessionId}${autoPrint ? "?autoprint=1" : ""}`);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Payment failed", description: err?.message ?? "Something went wrong." });
      setIsCompletingPayment(false);
    }
  };
  
  if (isLoading || !session || !storeId || !activeStore) {
      return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin" /> Loading session...</div>;
  }
  
  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-4 border-b bg-muted/40 px-6 h-[72px]">
        <Button variant="outline" size="icon" onClick={() => router.push('/cashier')} className="h-9 w-9">
            <ArrowLeft className="h-5 w-5" />
        </Button>
        <SessionHeader session={{
            id: session.id, tableNumber: session.tableNumber, guestCount: session.guestCountFinal || 0,
            packageName: session.packageName ?? "N/A", sessionMode: session.sessionMode, customerName: session.customer?.name ?? session.customerName,
        }} />
        <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsTimelineOpen(true)}>
                <History className="mr-2 h-4 w-4" /> View Timeline
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push(`/receipt/${sessionId}`)} disabled={!session.isPaid}>
                <Receipt className="mr-2 h-4 w-4" /> Receipt
            </Button>
        </div>
      </header>
      
      <main className="flex-1 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 h-full">
            <div className="md:col-span-1 xl:col-span-2 bg-muted/20 h-full flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                    <CustomerInfoForm session={session} />
                    <BillTotals totals={billTotals} totalPaid={totalPaid} onRemoveDiscount={() => {}} isLocked={isBillingLocked} />
                </div>
                <BillAdjustments charges={charges} discounts={billableDiscounts} onAddAdjustment={() => {}} onAddCustomAdjustment={()=>{}} onRemoveAdjustment={() => {}} onSetBillDiscount={setBillDiscount} billDiscount={billDiscount} isLocked={isBillingLocked} />
            </div>
            <div className="md:col-span-1 xl:col-span-3 p-4 h-full flex flex-col gap-4 overflow-y-auto">
                <BillableItems 
                    lines={billLines}
                    storeId={storeId} 
                    session={session} 
                    discounts={itemDiscounts}
                    isLocked={isBillingLocked} 
                />
                <PaymentSection paymentMethods={paymentMethods} payments={payments} setPayments={setPayments} totalPaid={totalPaid} remainingBalance={remainingBalance} change={change} isLocked={isBillingLocked} />
                 <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm py-3 rounded-lg mt-auto">
                    <Button type="button" className="w-full" size="lg" disabled={!canCompletePayment || isBillingLocked || isCompletingPayment} onClick={handleCompletePayment}>
                        {isCompletingPayment ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating receipt...</> : isBillingLocked ? 'Payment Finalized' : 'Complete Payment'}
                    </Button>
                </div>
            </div>
        </div>
      </main>

       {isTimelineOpen && (
        <SessionTimelineDrawer open={isTimelineOpen} onOpenChange={setIsTimelineOpen} storeId={storeId} sessionId={sessionId!} />
       )}
       
      {Dialog}
    </div>
  )
}

    