
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
import { moveTicketIdsBetweenLines } from "./billable-lines";
import type { KitchenTicket, ModeOfPayment, PendingSession, Payment, Charge, Discount, BillableLine, Adjustment, PackageUnit, Store } from "@/lib/types";
import { calculateBillTotals } from "@/lib/tax";

export type BillUnit = (KitchenTicket & { unitType: 'addon' }) | (PackageUnit & { unitType: 'package' });


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
  const [kitchenTickets, setKitchenTickets] = useState<KitchenTicket[]>([]);
  const [packageUnits, setPackageUnits] = useState<PackageUnit[]>([]);
  
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

    const ticketsQuery = query(collection(db, `stores/${storeId}/sessions/${sessionId}/kitchentickets`));
    const unsubTickets = onSnapshot(ticketsQuery, (snapshot) => {
      setKitchenTickets(snapshot.docs.map(d => ({id: d.id, ...d.data()} as KitchenTicket)));
    }, (e) => console.error("kitchentickets listener failed:", e));

    const unitsQuery = query(collection(db, `stores/${storeId}/sessions/${sessionId}/packageUnits`));
    const unsubUnits = onSnapshot(unitsQuery, (snapshot) => {
        setPackageUnits(snapshot.docs.map(d => ({id: d.id, ...d.data()} as PackageUnit)));
    }, (e) => console.error("packageUnits listener failed:", e));

    return () => {
      unsubTickets();
      unsubUnits();
    };
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

  const billUnits = useMemo((): BillUnit[] => {
    const addonUnits = kitchenTickets
        .filter(t => t.type === 'addon' && t.billing)
        .map(t => ({ ...t, unitType: 'addon' as const }));

    const pkgUnits = packageUnits.map(u => ({ ...u, unitType: 'package' as const }));
    
    return [...addonUnits, ...pkgUnits];
  }, [kitchenTickets, packageUnits]);
  
  const isBillingLocked = session?.status !== 'active' || session?.isPaid;

  const billTotals = useMemo(() => {
    return calculateBillTotals(billUnits, activeStore as Store, billDiscount, charges);
  }, [billUnits, activeStore, billDiscount, charges]);
  
  const { grandTotal } = billTotals;
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = grandTotal - totalPaid;
  const change = totalPaid > grandTotal ? totalPaid - grandTotal : 0;
  const pendingItemsCount = useMemo(() => kitchenTickets.filter(t => t.type === 'addon' && (t.status === 'preparing' || t.status === 'ready')).length, [kitchenTickets]);
  const canCompletePayment = pendingItemsCount === 0 && grandTotal > 0 && remainingBalance <= 0;

  const handleApplyDiscount = async (unitsToUpdate: BillUnit[], discountType: "fixed" | "percent", discountValue: number) => {
    if (isBillingLocked || !storeId || !session || !appUser) return;
    
    const batch = writeBatch(db);
    unitsToUpdate.forEach(unit => {
        const refPath = unit.unitType === 'package' 
            ? `stores/${storeId}/sessions/${sessionId}/packageUnits/${unit.id}`
            : `stores/${storeId}/sessions/${sessionId}/kitchentickets/${unit.id}`;
        batch.update(doc(db, refPath), { "billing.discountType": discountType, "billing.discountValue": discountValue });
    });

    try {
        await batch.commit();
        toast({ title: "Discount Applied" });
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  const handleApplyFree = async (unitsToUpdate: BillUnit[], isFree: boolean) => {
     if (isBillingLocked || !storeId || !session || !appUser) return;
     const actionText = isFree ? "Mark as Free" : "Remove Free Status";
    
    const ok = await confirm({
        title: `${actionText} for ${unitsToUpdate.length} item(s)?`,
        confirmText: "Confirm",
        destructive: false,
    });
    if (!ok) return;

    const batch = writeBatch(db);
    unitsToUpdate.forEach(unit => {
        const refPath = unit.unitType === 'package' 
            ? `stores/${storeId}/sessions/${sessionId}/packageUnits/${unit.id}`
            : `stores/${storeId}/sessions/${sessionId}/kitchentickets/${unit.id}`;
        batch.update(doc(db, refPath), { "billing.isFree": isFree });
    });

    try {
        await batch.commit();
        toast({ title: "Update Successful", description: `Item(s) have been updated.` });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  const handleRemoveDiscount = async (unitsToUpdate: BillUnit[]) => {
    if (isBillingLocked || !storeId || !appUser) return;
    
    const batch = writeBatch(db);
    unitsToUpdate.forEach(unit => {
        const refPath = unit.unitType === 'package' 
            ? `stores/${storeId}/sessions/${sessionId}/packageUnits/${unit.id}`
            : `stores/${storeId}/sessions/${sessionId}/kitchentickets/${unit.id}`;
        batch.update(doc(db, refPath), { "billing.discountType": null, "billing.discountValue": null });
    });
    
    try {
        await batch.commit();
        toast({ title: "Discount Removed" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  }

  const handleVoidItem = async (unitsToUpdate: BillUnit[], reason: string, note?: string) => {
    if (isBillingLocked || !appUser || !storeId || !session) return;
    
    const batch = writeBatch(db);
    unitsToUpdate.forEach(unit => {
      if (unit.unitType === 'package') return; // Cannot void packages this way
      const docRef = doc(db, `stores/${storeId}/sessions/${sessionId}/kitchentickets`, unit.id);
      batch.update(docRef, { "billing.isVoided": true, "billing.voidReason": reason, "billing.voidNote": note });
    });

    try {
        await batch.commit();
        toast({ title: "Item(s) voided" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Void failed", description: e?.message ?? "Unknown error" });
    }
  };

  const handleCompletePayment = async () => {
    if (isCompletingPayment || isBillingLocked) return;

    const paymentError = validatePayments(payments, grandTotal, paymentMethods);
    if (paymentError) {
        toast({ variant: "destructive", title: "Cannot Complete", description: paymentError });
        return;
    }
    if (!canCompletePayment) {
      toast({ variant: "destructive", title: "Cannot Complete", description: "Please ensure balance is paid and all items are served." });
      return;
    }
    setIsCompletingPayment(true);
    try {
        if (!appUser || !activeStore || !session) return;
        const normalizedPayments = payments.map(p => ({...p, amount: Math.round(p.amount * 100) / 100}));
        
        // This is where the old function was called. Now billTotals is used directly.
        await completePaymentFromUnits(activeStore.id, sessionId, appUser, normalizedPayments, billUnits, billTotals, paymentMethods);
        
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
                    <BillTotals totals={billTotals} totalPaid={totalPaid} onRemoveDiscount={handleRemoveDiscount} isLocked={isBillingLocked} />
                </div>
                <BillAdjustments charges={charges} discounts={billableDiscounts} onAddAdjustment={() => {}} onAddCustomAdjustment={()=>{}} onRemoveAdjustment={() => {}} onSetBillDiscount={setBillDiscount} billDiscount={billDiscount} isLocked={isBillingLocked} />
            </div>
            <div className="md:col-span-1 xl:col-span-3 p-4 h-full flex flex-col gap-4 overflow-y-auto">
                <BillableItems 
                    units={billUnits}
                    storeId={storeId} 
                    session={session} 
                    discounts={itemDiscounts}
                    onApplyDiscount={handleApplyDiscount}
                    onApplyFree={handleApplyFree}
                    onVoidItem={handleVoidItem}
                    isLocked={isBillingLocked} 
                />
                <PaymentSection paymentMethods={paymentMethods} payments={payments} setPayments={setPayments} totalPaid={totalPaid} remainingBalance={remainingBalance} change={change} isLocked={isBillingLocked} />
                 <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm py-3 rounded-lg mt-auto">
                    {pendingItemsCount > 0 && (
                        <Alert variant="default" className="mb-2">
                           <AlertCircle className="h-4 w-4" />
                           <AlertTitle>Pending Items</AlertTitle>
                           <AlertDescription>{pendingItemsCount} item(s) are still in the kitchen. Payment is blocked until all items are served or voided.</AlertDescription>
                        </Alert>
                    )}
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
