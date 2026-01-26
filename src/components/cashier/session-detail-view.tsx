

"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { collection, onSnapshot, query, doc, getDocs, Timestamp, orderBy, updateDoc, writeBatch, getDoc, where, serverTimestamp, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { completePaymentFromUnits, updateSessionBillLine, voidSession, removeLineAdjustment } from "@/components/cashier/firestore";
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
import type { KitchenTicket, ModeOfPayment, PendingSession, Payment, Charge, Discount, SessionBillLine, Store, Adjustment, LineAdjustment } from "@/lib/types";
import { calculateBillTotals } from "@/lib/tax";
import { EditBillableItemDialog } from "./edit-billable-item-dialog";
import { writeActivityLog } from "./activity-log";

// Validation logic using cents
function validatePayments(payments: Payment[], grandTotalCents: number, paymentMethods: ModeOfPayment[]): string | null {
    if (!payments || payments.length === 0) return "Add at least one payment method.";
    for (const p of payments) {
        if (!p.methodId) return "Select a payment method.";
        const amountCents = Math.round(Number(p.amount || 0) * 100);
        if (amountCents <= 0) return "Payment amounts must be greater than zero.";
        
        const methodDetails = paymentMethods.find(pm => pm.id === p.methodId);
        if (methodDetails?.hasRef && (!p.reference || String(p.reference).trim().length === 0)) {
            return `Reference is required for ${methodDetails.name}.`;
        }
    }
    const totalPaidCents = payments.reduce((s, p) => s + Math.round(Number(p.amount || 0) * 100), 0);
    
    // Use a small tolerance for floating point comparisons
    if (totalPaidCents < grandTotalCents - 1) { // Allow for a 1 cent rounding diff
        return `Payment is not enough to cover the total. Balance: ₱${((grandTotalCents - totalPaidCents) / 100).toFixed(2)}`;
    }
    
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
  const [customAdjustments, setCustomAdjustments] = useState<Adjustment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isCompletingPayment, setIsCompletingPayment] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  
  const [editingLineId, setEditingLineId] = useState<string | null>(null);

  const editingLine = useMemo(() => {
    if (!editingLineId) return null;
    return billLines.find(line => line.id === editingLineId) || null;
  }, [billLines, editingLineId]);

  const storeId = activeStore?.id;

  useEffect(() => {
    if (!storeId) return;
    const sessionRef = doc(db, "stores", storeId, "sessions", sessionId);
    const unsubscribe = onSnapshot(sessionRef, (doc) => {
        if (doc.exists()) {
            const data = doc.data();
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

  // Sync package quantity based on approved guest count changes
  useEffect(() => {
    if (!session || !appUser || !storeId || billLines.length === 0) return;

    const packageLine = billLines.find(line => line.type === 'package');
    if (!packageLine) return;

    const guestChange = session.guestCountChange;
    const approvedAt = guestChange?.status === 'approved' ? guestChange.approvedAt : null;

    if (approvedAt) {
      // A new approval has occurred. Check if we've already synced for this approval.
      if (packageLine.qtyLastSyncedApprovedAt !== approvedAt.toString()) {
        console.log(`New approval detected. Re-syncing package qty to ${session.guestCountFinal}.`);
        updateSessionBillLine(storeId, sessionId, packageLine.id, {
          qtyOrdered: session.guestCountFinal || packageLine.qtyOrdered,
          qtyOverrideActive: false, // Reset the override
          qtyLastSyncedApprovedAt: approvedAt.toString(),
        }, appUser).catch(err => console.error("Failed to re-sync package qty after approval:", err));
      }
    } else {
      // No current approval. If no override is active, ensure qty matches final count.
      // This handles initial load and any other state corrections.
      if (!packageLine.qtyOverrideActive && session.guestCountFinal !== null && packageLine.qtyOrdered !== session.guestCountFinal) {
        console.log(`No override active. Aligning package quantity to ${session.guestCountFinal}.`);
        updateSessionBillLine(storeId, sessionId, packageLine.id, {
          qtyOrdered: session.guestCountFinal
        }, appUser).catch(err => console.error("Failed to align package quantity:", err));
      }
    }
  }, [session, billLines, appUser, storeId, sessionId]);


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
  
  const billableDiscounts = useMemo(() => discounts.filter(d => d.isEnabled && !d.isArchived && (Array.isArray(d.scope) ? d.scope.includes("bill") : d.scope === "bill")), [discounts]);
  const itemDiscounts = useMemo(() => discounts.filter(d => d.isEnabled && !d.isArchived && (Array.isArray(d.scope) ? d.scope.includes("item") : d.scope === "item")), [discounts]);
  
  const isBillingLocked = session?.status !== 'active' || session?.isPaid;

  const billTotals = useMemo(() => {
    return calculateBillTotals(billLines, activeStore, billDiscount, customAdjustments);
  }, [billLines, activeStore, billDiscount, customAdjustments]);
  
  const { grandTotal } = billTotals;
  
  const grandTotalCents = Math.round(grandTotal * 100);
  const totalPaidCents = payments.reduce((sum, p) => sum + Math.round(Number(p.amount || 0) * 100), 0);
  const remainingCents = grandTotalCents - totalPaidCents;
  
  const totalPaid = totalPaidCents / 100;
  const remainingBalance = remainingCents / 100;
  const change = Math.max(0, -remainingCents) / 100;
  
  const canCompletePayment = grandTotalCents > 0 && remainingCents <= 1; // Allow for 1 cent rounding diff

  const handleUpdateLine = async (lineId: string, before: Partial<SessionBillLine>, after: Partial<SessionBillLine>) => {
    if (!appUser || !storeId || !sessionId) return;
    try {
        await updateSessionBillLine(storeId, sessionId, lineId, after, appUser);

        const line = billLines.find(l => l.id === lineId);
        if (!line) return;

        // Determine specific action for logging
        const diff = {
            qtyOrdered: (after.qtyOrdered ?? 0) - (before.qtyOrdered ?? 0),
            discount: (after.discountQty ?? 0) - (before.discountQty ?? 0),
            free: (after.freeQty ?? 0) - (before.freeQty ?? 0),
            void: (after.voidedQty ?? 0) - (before.voidedQty ?? 0),
        };
        
        const unitPrice = Number.isFinite(Number(line.unitPrice)) ? Number(line.unitPrice) : 0;

        if (line.type === 'package' && diff.qtyOrdered > 0) {
            await writeActivityLog({ action: "PACKAGE_QTY_OVERRIDE_SET", meta: { itemName: line.itemName, beforeQty: before.qtyOrdered, afterQty: after.qtyOrdered }, storeId, sessionId, user: appUser });
        }
        if (diff.discount > 0) {
            await writeActivityLog({ action: "DISCOUNT_APPLIED", qty: diff.discount, meta: { itemName: line.itemName }, storeId, sessionId, user: appUser });
        } else if (diff.discount < 0) {
            await writeActivityLog({ action: "DISCOUNT_REMOVED", qty: -diff.discount, meta: { itemName: line.itemName }, storeId, sessionId, user: appUser });
        }

        if (diff.free > 0) {
          await writeActivityLog({
            action: "MARK_FREE",
            qty: diff.free,
            note: "Marked item free",
            meta: {
              itemId: line.itemId,
              itemName: line.itemName,
              qty: Math.abs(diff.free),
              unitPriceAfter: unitPrice,
              amount: Math.abs(diff.free) * unitPrice,
            },
            storeId, sessionId, user: appUser
          });
        } else if (diff.free < 0) {
          await writeActivityLog({
            action: "UNMARK_FREE",
            qty: -diff.free,
            note: "Removed free tag",
            meta: {
              itemId: line.itemId,
              itemName: line.itemName,
              qty: Math.abs(diff.free),
              unitPriceAfter: unitPrice,
              amount: Math.abs(diff.free) * unitPrice,
            },
            storeId, sessionId, user: appUser
          });
        }
        
        if (diff.void > 0) {
          await writeActivityLog({
            action: "VOID_TICKETS",
            qty: diff.void,
            note: "Voided item",
            meta: {
              itemId: line.itemId,
              itemName: line.itemName,
              qty: Math.abs(diff.void),
              unitPriceAfter: unitPrice,
              amount: Math.abs(diff.void) * unitPrice,
            },
            storeId, sessionId, user: appUser
          });
        } else if (diff.void < 0) {
          await writeActivityLog({
            action: "UNVOID",
            qty: -diff.void,
            note: "Unvoided item",
            meta: {
              itemId: line.itemId,
              itemName: line.itemName,
              qty: Math.abs(diff.void),
              unitPriceAfter: unitPrice,
              amount: Math.abs(diff.void) * unitPrice,
            },
            storeId, sessionId, user: appUser
          });
        }

        toast({ title: "Line Item Updated"});
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  }

  const handleAddLineAdjustment = async (lineId: string, adj: LineAdjustment) => {
    if (!appUser || !storeId || !sessionId || !activeStore) return;
    try {
        const lineRef = doc(db, 'stores', storeId, 'sessions', sessionId, 'sessionBillLines', lineId);
        await updateDoc(lineRef, {
            [`lineAdjustments.${adj.id}`]: adj,
        });
        toast({ title: 'Adjustment Added'});
        
        if (adj.kind === 'discount') {
            const line = billLines.find(l => l.id === lineId);
            if(line) {
                const billableQty = line.qtyOrdered - (line.voidedQty || 0) - (line.freeQty || 0);
                const qtyToApply = Math.min(adj.qty, billableQty);
                const unitPrice = line.unitPrice || 0;
                const taxRate = (activeStore.taxRatePct || 0) / 100;
                const isVatInclusive = activeStore.taxType === 'VAT_INCLUSIVE';
                const baseUnitPrice = isVatInclusive ? unitPrice / (1 + taxRate) : unitPrice;

                let calculatedAmount = 0;
                if (adj.type === 'percent') {
                    calculatedAmount = (qtyToApply * baseUnitPrice) * (adj.value / 100);
                } else {
                    calculatedAmount = Math.min(baseUnitPrice, adj.value) * qtyToApply;
                }

                await writeActivityLog({
                    action: "DISCOUNT_APPLIED",
                    storeId,
                    sessionId,
                    user: appUser,
                    note: `Applied to ${line.itemName}`,
                    meta: {
                        lineId: line.id,
                        itemName: line.itemName,
                        discountName: adj.note,
                        scope: "item",
                        qty: adj.qty,
                        discountType: adj.type,
                        amount: calculatedAmount,
                    }
                });
            }
        }
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  }

  const handleRemoveLineAdjustment = async (lineId: string, adjId: string) => {
    if (!activeStore?.id || !sessionId || !appUser) return;
    await removeLineAdjustment(activeStore.id, sessionId, lineId, adjId, appUser);
  };


  const handleCompletePayment = async () => {
    if (isCompletingPayment || isBillingLocked) return;

    const paymentError = validatePayments(payments, grandTotalCents, paymentMethods);
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
        const normalizedPayments = payments.map(p => ({...p, amount: Math.round(Number(p.amount || 0) * 100) / 100}));
        
        await completePaymentFromUnits(
            activeStore.id,
            sessionId,
            appUser,
            normalizedPayments,
            billLines,
            activeStore,
            paymentMethods,
            billDiscount,
            customAdjustments
        );
        
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
            packageName: session.packageSnapshot?.name ?? "N/A", sessionMode: session.sessionMode, customerName: session.customer?.name ?? session.customerName,
        }} />
        <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsTimelineOpen(true)}>
                <History className="mr-2 h-4 w-4" /> View Timeline
            </Button>
            {session.isPaid && (
              <Button variant="outline" size="sm" onClick={() => router.push(`/receipt/${sessionId}`)}>
                  <Receipt className="mr-2 h-4 w-4" /> View Receipt
              </Button>
            )}
        </div>
      </header>
      
      <main className="flex-1 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 h-full">
            <div className="md:col-span-1 xl:col-span-2 bg-muted/20 h-full flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                    <CustomerInfoForm session={session} />
                    <BillTotals 
                        lines={billLines} 
                        store={activeStore} 
                        billDiscount={billDiscount}
                        customAdjustments={customAdjustments}
                        totalPaid={totalPaid} 
                        isLocked={isBillingLocked} 
                        onRemoveLineAdjustment={handleRemoveLineAdjustment}
                    />
                </div>
                <BillAdjustments
                    appUser={appUser}
                    charges={charges} 
                    discounts={billableDiscounts} 
                    onAddAdjustment={(charge: Charge) => setCustomAdjustments(prev => [...prev, {id: charge.id, note: charge.name, amount: charge.value, type: charge.type, source: 'charge', sourceId: charge.id}])} 
                    onAddCustomAdjustment={(note, amount) => setCustomAdjustments(prev => [...prev, {id: `custom_${Date.now()}`, note, amount, type: 'fixed', source: 'custom'}])} 
                    onRemoveAdjustment={(id) => setCustomAdjustments(prev => prev.filter(adj => adj.id !== id))} 
                    onSetBillDiscount={setBillDiscount} 
                    billDiscount={billDiscount} 
                    adjustments={customAdjustments || []} 
                    isLocked={isBillingLocked} 
                />
            </div>
            <div className="md:col-span-1 xl:col-span-3 p-4 h-full flex flex-col gap-4 overflow-y-auto">
                <BillableItems 
                    lines={billLines}
                    storeId={storeId} 
                    session={session} 
                    discounts={itemDiscounts}
                    isLocked={isBillingLocked}
                    onUpdateLine={(line) => setEditingLineId(line.id)}
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
       
       {editingLine && (
        <EditBillableItemDialog
            isOpen={!!editingLine}
            onClose={() => setEditingLineId(null)}
            line={editingLine}
            discounts={itemDiscounts}
            isLocked={isBillingLocked}
            onSave={handleUpdateLine}
            onAddLineAdjustment={handleAddLineAdjustment}
        />
      )}
      {Dialog}
    </div>
  )
}
