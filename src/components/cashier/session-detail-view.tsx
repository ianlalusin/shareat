
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { collection, onSnapshot, query, doc, getDocs, Timestamp, orderBy, updateDoc, writeBatch, getDoc, where, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { completePayment, updateKitchenTicketStatus, voidBillableItems, updateBillableUnitPrice } from "@/components/cashier/firestore";
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
import type { KitchenTicket, OrderItemStatus, StoreAddon, ModeOfPayment, PendingSession, StorePackage, StoreFlavor, MenuSchedule, Payment, Charge, Discount, BillableItem, GroupedBillableItem, Adjustment } from "@/lib/types";

function hasScope(discount: Discount, scopeKey: "item" | "bill"): boolean {
  const scope = (discount as any).scope;
  if (!scope || !Array.isArray(scope)) return false;
  return scope.includes(scopeKey);
}

export function SessionDetailView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();

  const [session, setSession] = useState<PendingSession | null>(null);
  const [billables, setBillables] = useState<Map<string, BillableItem>>(new Map());
  const [tickets, setTickets] = useState<Map<string, KitchenTicket>>(new Map());
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [billDiscount, setBillDiscount] = useState<Discount | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [isCompletingPayment, setIsCompletingPayment] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);

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

  useEffect(() => {
    if (!activeStore) return;
    const sessionRef = doc(db, "stores", activeStore.id, "sessions", sessionId);
    const unsubscribe = onSnapshot(sessionRef, (doc) => {
        if (doc.exists()) {
            const data = doc.data();
            if (data.status === 'closed' && router) {
                router.replace(`/receipt/${sessionId}`);
                return;
            }
            setSession({ id: doc.id, ...data } as PendingSession);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: 'Session not found.' });
            router.replace('/cashier');
        }
    }, (error) => {
      console.error("Error fetching session:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not load session data.' });
      router.replace('/cashier');
    });
    return () => unsubscribe();
  }, [sessionId, activeStore, router, toast]);

  useEffect(() => {
      if (!activeStore) return;
      const ticketsRef = collection(db, "stores", activeStore.id, "sessions", sessionId, "kitchentickets");
      const q = query(ticketsRef, orderBy("createdAt", "asc"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
          const ticketItems = new Map<string, KitchenTicket>();
          snapshot.docs.forEach(docSnap => {
            ticketItems.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as Omit<KitchenTicket, 'id'>) });
          });
          setTickets(ticketItems);
      });
      return () => unsubscribe();
  }, [sessionId, activeStore]);

  useEffect(() => {
    if (!activeStore) return;
    const billablesRef = collection(db, "stores", activeStore.id, "sessions", sessionId, "billables");
    const q = query(billablesRef, orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const billablesMap = new Map<string, BillableItem>();
        snapshot.docs.forEach(docSnap => {
            billablesMap.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as Omit<BillableItem, 'id'>) });
        });
        setBillables(billablesMap);
    });
    return () => unsubscribe();
  }, [sessionId, activeStore]);

  useEffect(() => {
    if (!activeStore) return;
    const unsubs: (() => void)[] = [];
    unsubs.push(onSnapshot(query(collection(db, "stores", activeStore.id, "storeModesOfPayment"), where("isArchived", "==", false), where("isActive", "==", true), orderBy("sortOrder", "asc"), orderBy("name", "asc")), (snapshot) => {
        setPaymentMethods(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ModeOfPayment)));
    }));
    unsubs.push(onSnapshot(query(collection(db, "stores", activeStore.id, "storeCharges"), where("isArchived", "==", false), where("isEnabled", "==", true), orderBy("sortOrder", "asc"), orderBy("name", "asc")), (snapshot) => {
        setCharges(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Charge)));
    }));
    unsubs.push(onSnapshot(query(collection(db, "stores", activeStore.id, "storeDiscounts"), where("isArchived", "==", false), where("isEnabled", "==", true), orderBy("sortOrder", "asc"), orderBy("name", "asc")), (snapshot) => {
        setDiscounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Discount)));
    }));
    return () => unsubs.forEach(unsub => unsub());
  }, [activeStore]);

  const billableDiscounts = useMemo(() => discounts.filter(d => d.isEnabled && !d.isArchived && hasScope(d, "bill")), [discounts]);
  const itemDiscounts = useMemo(() => discounts.filter(d => d.isEnabled && !d.isArchived && hasScope(d, "item")), [discounts]);

  const groupedItems = useMemo<GroupedBillableItem[]>(() => {
    const mergedItems: BillableItem[] = Array.from(billables.values()).map(billable => {
        const ticket = tickets.get(billable.id);
        const qty = billable.type === "package" ? (session?.guestCountFinal ?? billable.qty ?? 1) : billable.qty;
        return { ...billable, qty, status: ticket?.status || 'served' };
    });

    const groups: Record<string, GroupedBillableItem> = {};
    mergedItems.forEach(item => {
        const discountKey = item.isFree ? 'free' : `${item.lineDiscountType}-${item.lineDiscountValue}`;
        const voidKey = item.isVoided ? 'voided' : 'active';
        const key = `${voidKey}|${item.status}|${item.type}|${item.itemName}|${item.unitPrice}|${discountKey}`;
        
        if (!groups[key]) {
            groups[key] = { ...item, key, isGrouped: false, totalQty: 0, servedQty: 0, pendingQty: 0, cancelledQty: 0, ticketIds: [], createdAtMin: item.createdAt };
        }
        
        groups[key].totalQty += item.qty;
        if (item.status === 'served') groups[key].servedQty += item.qty;
        else if (item.status === 'preparing' || item.status === 'ready') groups[key].pendingQty += item.qty;
        else if (item.status === 'cancelled') groups[key].cancelledQty += item.qty;

        groups[key].ticketIds.push(item.id);
        
        const getItemTime = (date: any) => typeof date.toMillis === 'function' ? date.toMillis() : new Date(date).getTime();
        if (item.createdAt && (!groups[key].createdAtMin || getItemTime(item.createdAt) < getItemTime(groups[key].createdAtMin))) {
            groups[key].createdAtMin = item.createdAt;
        }

        if (groups[key].ticketIds.length > 1 || item.type === "package") {
            groups[key].isGrouped = true;
        }
    });

    return Object.values(groups).sort((a, b) => {
        if (a.type === 'package' && b.type !== 'package') return -1;
        if (a.type !== 'package' && b.type === 'package') return 1;
        const getItemTime = (date: any) => typeof date.toMillis === 'function' ? date.toMillis() : new Date(date).getTime();
        return getItemTime(a.createdAtMin) - getItemTime(b.createdAtMin);
    });
  }, [tickets, billables, session]);

  const isBillingLocked = session?.status !== 'active' || session?.isPaid;

  const handleUpdateQty = async (ticketIds: string[], newQty: number) => {
    if (isBillingLocked || !activeStore || !session || newQty < 1) return;
    const batch = writeBatch(db);
    ticketIds.forEach(ticketId => {
        batch.update(doc(db, "stores", activeStore.id, "sessions", sessionId, "kitchentickets", ticketId), { qty: newQty });
        batch.update(doc(db, "stores", activeStore.id, "sessions", sessionId, "billables", ticketId), { qty: newQty });
    });
    try {
        await batch.commit();
        toast({ title: "Quantity Updated" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };
  
  const handleUpdateUnitPrice = async (ticketIds: string[], newPrice: number) => {
    if (isBillingLocked || !appUser || !activeStore || !session) return;
    try {
        await updateBillableUnitPrice(appUser, activeStore.id, sessionId, ticketIds, newPrice);
        toast({ title: "Unit Price Updated" });
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  const handleApplyDiscount = async (ticketIds: string[], discountType: "fixed" | "percent", discountValue: number, quantity: number) => {
    if (isBillingLocked || !activeStore || !session) return;
    const batch = writeBatch(db);
    ticketIds.slice(0, quantity).forEach(ticketId => {
        batch.update(doc(db, "stores", activeStore.id, "sessions", sessionId, "billables", ticketId), {
            lineDiscountType: discountType, lineDiscountValue: discountValue, isFree: false, updatedAt: serverTimestamp()
        });
    });
    try {
        await batch.commit();
        toast({ title: "Discount Applied" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  const handleApplyFree = async (ticketIds: string[], quantity: number, currentIsFree: boolean) => {
    if (isBillingLocked || !activeStore || !session) return;
    const batch = writeBatch(db);
    const newIsFree = !currentIsFree;
    (currentIsFree ? ticketIds : ticketIds.slice(0, quantity)).forEach(ticketId => {
        batch.update(doc(db, "stores", activeStore.id, "sessions", sessionId, "billables", ticketId), { isFree: newIsFree, lineDiscountValue: 0, updatedAt: serverTimestamp() });
    });
    try {
        await batch.commit();
        toast({ title: newIsFree ? "Item(s) marked as Free" : "Free status removed" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  const handleRemoveDiscount = async (ticketIds: string[]) => {
    if (isBillingLocked || !activeStore || !session) return;
    const batch = writeBatch(db);
    ticketIds.forEach(ticketId => {
        batch.update(doc(db, "stores", activeStore.id, "sessions", sessionId, "billables", ticketId), {
            lineDiscountType: "fixed", lineDiscountValue: 0, isFree: false, updatedAt: serverTimestamp()
        });
    });
    try {
        await batch.commit();
        toast({ title: "Discount Removed" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  }

  const handleCashierItemStatusUpdate = async (itemId: string, newStatus: 'served' | 'void' | 'cancelled', reason?: string) => {
    if (isBillingLocked || !appUser || !activeStore || !session) return;
    try {
        await updateKitchenTicketStatus(activeStore.id, sessionId, itemId, newStatus, appUser, reason);
        toast({ title: 'Item Updated', description: `Item has been marked as ${newStatus}.` });
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: error.message });
    }
  }

  const handleVoidItem = (ticketId: string, reason: string, note?: string) => {
    if (!appUser || !activeStore || !session) return;
    if (isBillingLocked) return;

    void (async () => {
        try {
            await voidBillableItems(appUser, activeStore.id, session.id, [ticketId], reason, note);
            toast({ title: "Item voided" });
        } catch (e: any) {
            toast({
                variant: "destructive",
                title: "Void failed",
                description: e?.message ?? "Unknown error",
            });
        }
    })();
  };

  const allBillableItems = Array.from(billables.values());
  const allServedItems: BillableItem[] = allBillableItems
    .filter(billable => !billable.isVoided && (tickets.get(billable.id)?.status === 'served' || (billable.type === 'package' && billable.status !== 'void' && billable.status !== 'cancelled')))
    .map(billable => ({ ...billable, qty: billable.type === "package" ? (session?.guestCountFinal ?? billable.qty ?? 1) : billable.qty }));
  const pendingItems = Array.from(tickets.values()).filter(t => t.status === "preparing" || t.status === 'ready');
  const subtotal = allServedItems.filter(item => !item.isFree).reduce((total, item) => total + (item.qty * item.unitPrice), 0);
  const lineDiscountsTotal = allServedItems.filter(item => !item.isFree).reduce((total, item) => {
    const lineTotal = item.qty * item.unitPrice;
    return total + (item.lineDiscountType === 'percent' ? (lineTotal * (item.lineDiscountValue / 100)) : Math.min(item.lineDiscountValue * item.qty, lineTotal));
  }, 0);
  const discountedSubtotal = subtotal - lineDiscountsTotal;
  const billDiscountAmount = billDiscount ? (billDiscount.type === 'percent' ? discountedSubtotal * (billDiscount.value / 100) : Math.min(billDiscount.value, discountedSubtotal)) : 0;
  const netSubtotalAfterDiscounts = Math.max(0, discountedSubtotal - billDiscountAmount);
  const addAdjustment = (charge: Charge) => {
    if (isBillingLocked) return;
    setAdjustments(prev => [...prev, { id: `adj-${Date.now()}`, note: charge.name, amount: charge.type === 'fixed' ? charge.value : netSubtotalAfterDiscounts * (charge.value / 100), source: 'charge', sourceId: charge.id }]);
  };
  const handleAddCustomAdjustment = (note: string, amount: number) => {
    if (isBillingLocked || !note || amount <= 0) {
        toast({ variant: 'destructive', title: 'Invalid Custom Charge', description: 'Please provide a valid note and amount.' });
        return;
    }
    setAdjustments(prev => [...prev, { id: `adj-custom-${Date.now()}`, note, amount, source: 'custom' }]);
    toast({ title: 'Custom Charge Added' });
  };
  const adjustmentsTotal = adjustments.reduce((total, adj) => total + adj.amount, 0);
  const grandTotal = netSubtotalAfterDiscounts + adjustmentsTotal;
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = grandTotal - totalPaid;
  const change = totalPaid > grandTotal ? totalPaid - grandTotal : 0;
  const canCompletePayment = pendingItems.length === 0 && allServedItems.length > 0;

  const handleCompletePayment = async () => {
    if (!appUser || !activeStore || !session || isCompletingPayment) return;
    if (session.status === "closed" || session.isPaid === true) {
      toast({ title: "Already paid", description: "This session is already closed." });
      router.push(`/receipt/${sessionId}`);
      return;
    }
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
        const normalizedPayments = payments.map(p => ({...p, amount: Math.round(p.amount * 100) / 100}));
        const billingSummary = { subtotal, lineDiscountsTotal, billDiscountAmount, adjustmentsTotal, grandTotal };
        await completePayment(activeStore.id, sessionId, appUser, normalizedPayments, allBillableItems, billingSummary, paymentMethods);
        const settingsSnap = await getDoc(doc(db, "stores", activeStore.id, "receiptSettings", "main"));
        const autoPrint = settingsSnap.exists() && !!settingsSnap.data()?.autoPrintAfterPayment;
        toast({ title: "Payment complete", description: "Session closed successfully." });
        router.push(`/receipt/${sessionId}${autoPrint ? "?autoprint=1" : ""}`);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Payment failed", description: err?.message ?? "Something went wrong." });
    } finally {
      setIsCompletingPayment(false);
    }
  };
  
  if (!session || !activeStore) {
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
            <Button variant="outline" size="sm" onClick={() => router.push(`/receipt/${sessionId}`)} disabled={session.status !== 'closed'}>
                <Receipt className="mr-2 h-4 w-4" /> Receipt
            </Button>
        </div>
      </header>
      
      <main className="flex-1 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 h-full">
            <div className="md:col-span-1 xl:col-span-2 bg-muted/20 h-full flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                    <CustomerInfoForm session={session} />
                    <BillTotals items={allServedItems} adjustments={adjustments} subtotal={subtotal} lineDiscountsTotal={lineDiscountsTotal} billDiscountAmount={billDiscountAmount} grandTotal={grandTotal} totalPaid={totalPaid} onRemoveDiscount={handleRemoveDiscount} />
                </div>
                <BillAdjustments adjustments={adjustments} billDiscount={billDiscount} charges={charges} discounts={billableDiscounts} onAddAdjustment={addAdjustment} onAddCustomAdjustment={handleAddCustomAdjustment} onRemoveAdjustment={(id) => setAdjustments(prev => prev.filter(adj => adj.id !== id))} onSetBillDiscount={setBillDiscount} isLocked={isBillingLocked} />
            </div>
            <div className="md:col-span-1 xl:col-span-3 p-4 h-full flex flex-col gap-4 overflow-y-auto">
                <BillableItems 
                    groupedItems={groupedItems} 
                    storeId={activeStore.id} 
                    session={session} 
                    discounts={itemDiscounts} 
                    onUpdateQty={handleUpdateQty}
                    onUpdateUnitPrice={handleUpdateUnitPrice}
                    onApplyDiscount={handleApplyDiscount} 
                    onApplyFree={handleApplyFree} 
                    onStatusUpdate={handleCashierItemStatusUpdate} 
                    onVoidItem={handleVoidItem}
                    isLocked={isBillingLocked} 
                />
                <PaymentSection paymentMethods={paymentMethods} payments={payments} setPayments={setPayments} totalPaid={totalPaid} remainingBalance={remainingBalance} change={change} isLocked={isBillingLocked} />
                 <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm py-3 rounded-lg mt-auto">
                    {pendingItems.length > 0 && (
                        <Alert variant="default" className="mb-2">
                           <AlertCircle className="h-4 w-4" />
                           <AlertTitle>Pending Items</AlertTitle>
                           <AlertDescription>{pendingItems.length} item(s) are still in the kitchen. Payment is blocked until all items are served or voided.</AlertDescription>
                        </Alert>
                    )}
                    <Button type="button" className="w-full" size="lg" disabled={!canCompletePayment || isBillingLocked || isCompletingPayment} onClick={handleCompletePayment}>
                        {isCompletingPayment ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Completing...</> : isBillingLocked ? 'Payment Finalized' : 'Complete Payment'}
                    </Button>
                </div>
            </div>
        </div>
      </main>

       {isTimelineOpen && (
        <SessionTimelineDrawer open={isTimelineOpen} onOpenChange={setIsTimelineOpen} storeId={activeStore.id} sessionId={sessionId!} />
       )}
    </div>
  )
}

    