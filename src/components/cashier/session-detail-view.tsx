
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { collection, onSnapshot, query, doc, getDocs, Timestamp, orderBy, updateDoc, writeBatch, getDoc, where, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { completePaymentFromBillableLines } from "@/components/cashier/firestore";
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
import { changeLineQty, moveTicketIdsBetweenLines, updateLineUnitPrice } from "./billable-lines";
import { EditBillableItemDialog } from "./edit-billable-item-dialog";
import type { KitchenTicket, ModeOfPayment, PendingSession, Payment, Charge, Discount, BillableLine } from "@/lib/types";
import { useConfirmDialog } from "../global/confirm-dialog";

function hasScope(discount: Discount, scopeKey: "item" | "bill"): boolean {
  const scope = (discount as any).scope;
  if (!scope || !Array.isArray(scope)) return false;
  return scope.includes(scopeKey);
}

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
  const [billableLines, setBillableLines] = useState<BillableLine[]>([]);
  const [ticketsById, setTicketsById] = useState<Map<string, KitchenTicket>>(new Map());
  
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [billDiscount, setBillDiscount] = useState<Discount | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  
  const [isCompletingPayment, setIsCompletingPayment] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<BillableLine | null>(null);

  useEffect(() => {
    if (!activeStore) return;
    const sessionRef = doc(db, "stores", activeStore.id, "sessions", sessionId);
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
    }, (error) => {
      console.error("Error fetching session:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not load session data.' });
      router.replace('/cashier');
    });
    return () => unsubscribe();
  }, [sessionId, activeStore, router, toast]);

  useEffect(() => {
    if (!activeStore) return;

    let unsubBillableLines: (() => void) | null = null;
    let unsubKdsTickets: (() => void) | null = null;

    unsubBillableLines = onSnapshot(
      query(collection(db, "stores", activeStore.id, "sessions", sessionId, "billableLines"), orderBy("createdAt", "asc")),
      (snapshot) => {
        const lines = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BillableLine[];
        setBillableLines(lines);
      }, (e) => console.error("billableLines listener failed:", e)
    );

    const ticketsQuery = query(collection(db, `stores/${activeStore.id}/sessions/${sessionId}/kitchentickets`));
    unsubKdsTickets = onSnapshot(ticketsQuery, (snapshot) => {
      const ticketsMap = new Map<string, KitchenTicket>();
      snapshot.forEach(doc => {
        ticketsMap.set(doc.id, { id: doc.id, ...doc.data() } as KitchenTicket);
      });
      setTicketsById(ticketsMap);
    }, (e) => console.error("kdsTickets listener failed:", e));

    return () => {
      unsubBillableLines?.();
      unsubKdsTickets?.();
    };
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

  const isBillingLocked = session?.status !== 'active' || session?.isPaid;

  const { subtotal, lineDiscountsTotal, pendingItemsCount } = useMemo(() => {
    let sub = 0;
    let lineDisc = 0;
    let pendingCount = 0;

    billableLines.forEach(line => {
      if (line.isVoided || line.isFree) return;
      
      const chargeableQty = line.type === 'package' ? (session?.guestCountFinal ?? line.qty) : line.qty;

      if (chargeableQty > 0) {
        const grossLineAmount = chargeableQty * line.unitPrice;
        sub += grossLineAmount;

        if ((line.discountValue ?? 0) > 0) {
          if (line.discountType === 'percent') {
            lineDisc += grossLineAmount * (line.discountValue! / 100);
          } else { // fixed
            lineDisc += Math.min(line.discountValue! * chargeableQty, grossLineAmount);
          }
        }
      }
      
      if (line.type === 'addon') {
          const pendingQty = getEligibleTicketIds(line, ticketsById, "pending").length;
          pendingCount += pendingQty;
      }
    });

    return { subtotal: sub, lineDiscountsTotal: lineDisc, pendingItemsCount: pendingCount };
  }, [billableLines, ticketsById, session]);

  const handleUpdateQty = async (lineId: string, newQty: number) => {
    if (isBillingLocked || !activeStore || !session || newQty < 1 || !appUser) return;
    const line = billableLines.find(l => l.id === lineId);
    if (!line) return;

    try {
        await changeLineQty(activeStore.id, sessionId, line, newQty, appUser, ticketsById);
        toast({ title: "Quantity Updated" });
    } catch(e: any) {
         toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };
  
  const handleUpdateUnitPrice = async (line: BillableLine, newPrice: number) => {
    if (isBillingLocked || !appUser || !activeStore || !session) return;
    try {
        await updateLineUnitPrice(activeStore.id, sessionId, line, newPrice, appUser);
        toast({ title: "Unit Price Updated" });
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  const handleApplyDiscount = async (line: BillableLine, discountType: "fixed" | "percent", discountValue: number, quantity: number) => {
    if (isBillingLocked || !activeStore || !session || !appUser) return;
    try {
        await moveTicketIdsBetweenLines({
            storeId: activeStore.id,
            sessionId,
            fromLineId: line.id,
            toVariant: { ...line, isFree: false, discountType, discountValue },
            ticketIdsToMove: line.ticketIds.slice(0, quantity),
            actor: appUser,
            action: 'DISCOUNT_APPLIED'
        });
        toast({ title: "Discount Applied" });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  const handleApplyFree = async (line: BillableLine, quantity: number, currentIsFree: boolean) => {
    if (isBillingLocked || !activeStore || !session || !appUser) return;

    if (!currentIsFree) {
        const ok = await confirm({
            title: `Mark ${quantity} item(s) as FREE?`,
            description: `This will mark ${quantity} x ${line.itemName} as free of charge.`,
            confirmText: "Confirm",
            destructive: false,
        });
        if (!ok) return;
    }

    try {
        await moveTicketIdsBetweenLines({
            storeId: activeStore.id,
            sessionId,
            fromLineId: line.id,
            toVariant: { ...line, isFree: !currentIsFree, discountValue: 0, discountType: 'fixed' },
            ticketIdsToMove: line.ticketIds.slice(0, quantity),
            actor: appUser,
            action: currentIsFree ? 'UNMARK_FREE' : 'MARK_FREE'
        });
        toast({ title: currentIsFree ? "Free Status Removed" : "Item Marked as Free" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  const handleRemoveDiscount = async (line: BillableLine) => {
    if (isBillingLocked || !activeStore || !session || !appUser) return;
    try {
        await moveTicketIdsBetweenLines({
            storeId: activeStore.id,
            sessionId,
            fromLineId: line.id,
            toVariant: { ...line, isFree: false, discountValue: 0, discountType: undefined },
            ticketIdsToMove: line.ticketIds,
            actor: appUser,
            action: 'DISCOUNT_REMOVED'
        });
        toast({ title: "Discount Removed" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  }

  const handleVoidItem = async (line: BillableLine, quantity: number, reason: string, note?: string) => {
    if (isBillingLocked || !appUser || !activeStore || !session) return;
    try {
      const eligibleIds = getEligibleTicketIds(line, ticketsById, 'any'); // Can void pending or served
      const targetIds = eligibleIds.slice(0, quantity);

      if (targetIds.length === 0) {
        toast({ variant: 'destructive', title: 'No items to void' });
        return;
      }
      
      await moveTicketIdsBetweenLines({
        storeId: activeStore.id,
        sessionId,
        fromLineId: line.id,
        toVariant: { ...line, isVoided: true, voidReason: reason, voidNote: note },
        ticketIdsToMove: targetIds,
        actor: appUser,
        action: 'VOID_TICKETS',
        reason,
        note
      });
      toast({ title: "Item(s) voided" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Void failed", description: e?.message ?? "Unknown error" });
    }
  };
  
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
  const canCompletePayment = pendingItemsCount === 0 && grandTotal > 0 && remainingBalance <= 0;

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
        const billingSummary = { subtotal, lineDiscountsTotal, billDiscountAmount, adjustmentsTotal, grandTotal };
        
        await completePaymentFromBillableLines(activeStore.id, sessionId, appUser, normalizedPayments, billableLines, billingSummary, paymentMethods);
        
        const settingsSnap = await getDoc(doc(db, "stores", activeStore.id, "receiptSettings", "main"));
        const autoPrint = settingsSnap.exists() && !!settingsSnap.data()?.autoPrintAfterPayment;
        toast({ title: "Payment complete", description: "Session closed successfully." });
        router.push(`/receipt/${sessionId}${autoPrint ? "?autoprint=1" : ""}`);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Payment failed", description: err?.message ?? "Something went wrong." });
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
                    <BillTotals lines={billableLines} subtotal={subtotal} lineDiscountsTotal={lineDiscountsTotal} billDiscountAmount={billDiscountAmount} adjustments={adjustments} grandTotal={grandTotal} totalPaid={totalPaid} onRemoveDiscount={(lineId) => handleRemoveDiscount(billableLines.find(l=>l.id === lineId)!)} isLocked={isBillingLocked} />
                </div>
                <BillAdjustments adjustments={adjustments} billDiscount={billDiscount} charges={charges} discounts={billableDiscounts} onAddAdjustment={addAdjustment} onAddCustomAdjustment={handleAddCustomAdjustment} onRemoveAdjustment={(id) => setAdjustments(prev => prev.filter(adj => adj.id !== id))} onSetBillDiscount={setBillDiscount} isLocked={isBillingLocked} />
            </div>
            <div className="md:col-span-1 xl:col-span-3 p-4 h-full flex flex-col gap-4 overflow-y-auto">
                <BillableItems 
                    lines={billableLines} 
                    tickets={ticketsById}
                    storeId={activeStore.id} 
                    session={session} 
                    discounts={itemDiscounts}
                    onUpdateQty={handleUpdateQty}
                    onUpdateUnitPrice={(lineId, newPrice) => handleUpdateUnitPrice(billableLines.find(l => l.id === lineId)!, newPrice)}
                    onApplyDiscount={(lineId, type, value, qty) => handleApplyDiscount(billableLines.find(l => l.id === lineId)!, type, value, qty)}
                    onApplyFree={(lineId, qty, isFree) => handleApplyFree(billableLines.find(l => l.id === lineId)!, qty, isFree)}
                    onVoidItem={(lineId, qty, reason, note) => handleVoidItem(billableLines.find(l => l.id === lineId)!, qty, reason, note)}
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
        <SessionTimelineDrawer open={isTimelineOpen} onOpenChange={setIsTimelineOpen} storeId={activeStore.id} sessionId={sessionId!} />
       )}
       
       {editingLine && appUser && (
        <EditBillableItemDialog
            isOpen={!!editingLine}
            onClose={() => setEditingLine(null)}
            line={editingLine}
            tickets={ticketsById}
            discounts={itemDiscounts}
            isLocked={isBillingLocked}
            onUpdateQty={handleUpdateQty}
            onUpdateUnitPrice={handleUpdateUnitPrice}
            onApplyDiscount={handleApplyDiscount}
            onApplyFree={handleApplyFree}
            onVoidItem={handleVoidItem}
        />
      )}
      {Dialog}
    </div>
  )
}
