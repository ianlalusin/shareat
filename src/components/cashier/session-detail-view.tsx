
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { collection, onSnapshot, query, doc, getDocs, Timestamp, orderBy, updateDoc, writeBatch, getDoc, where, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { completePayment, updateKitchenTicketStatus, updateBillableUnitPrice } from "@/components/cashier/firestore";
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
import { ensureBillableLinesForSession, moveTicketIdsBetweenLines, changeLineQty, getEligibleTicketIds } from "./billable-lines";
import { EditBillableItemDialog } from "./edit-billable-item-dialog";
import type { KitchenTicket, OrderItemStatus, StoreAddon, ModeOfPayment, PendingSession, StorePackage, StoreFlavor, MenuSchedule, Payment, Charge, Discount, BillableItem, GroupedBillableItem, BillableLine } from "@/lib/types";

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
  const [billableLines, setBillableLines] = useState<BillableLine[]>([]);
  const [legacyBillables, setLegacyBillables] = useState<Map<string, BillableItem>>(new Map());
  const [tickets, setTickets] = useState<Map<string, KitchenTicket>>(new Map());
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [billDiscount, setBillDiscount] = useState<Discount | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [isCompletingPayment, setIsCompletingPayment] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupedBillableItem | null>(null);

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

    let unsubBillableLines: (() => void) | null = null;
    let unsubLegacyBillables: (() => void) | null = null;
    let cancelled = false;

    (async () => {
        try {
            await ensureBillableLinesForSession(activeStore.id, sessionId);
            if (cancelled) return;

            unsubBillableLines = onSnapshot(
                collection(db, "stores", activeStore.id, "sessions", sessionId, "billableLines"),
                (snapshot) => {
                    const lines = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BillableLine[];
                    setBillableLines(lines);
                }
            );

        } catch (e) {
            console.error("BillableLines migration/listen failed, falling back to legacy:", e);
        } finally {
            // Always listen to legacy billables for now, but UI will prefer billableLines
             const legacyRef = collection(db, "stores", activeStore.id, "sessions", sessionId, "billables");
             unsubLegacyBillables = onSnapshot(query(legacyRef, orderBy("createdAt", "asc")), (legacySnap) => {
                 const billablesMap = new Map<string, BillableItem>();
                 legacySnap.docs.forEach(docSnap => {
                     billablesMap.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as Omit<BillableItem, "id">) });
                 });
                 setLegacyBillables(billablesMap);
             });
        }
    })();

    return () => {
        cancelled = true;
        unsubBillableLines?.();
        unsubLegacyBillables?.();
    };
}, [sessionId, activeStore]);


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
    if (billableLines.length > 0) {
        return billableLines.map(line => {
            const servedQty = getEligibleTicketIds(line, tickets, "served").length;
            const pendingQty = getEligibleTicketIds(line, tickets, "pending").length;
            
            return {
                ...line,
                key: line.id,
                isGrouped: line.qty > 1,
                totalQty: line.qty,
                servedQty: servedQty,
                pendingQty: pendingQty,
                cancelledQty: line.qty - (servedQty + pendingQty),
                createdAtMin: line.createdAt ?? null,
                lineDiscountType: line.discountType ?? 'fixed',
                lineDiscountValue: line.discountValue ?? 0,
            } as GroupedBillableItem
        });
    }

    // Fallback to legacy logic for old sessions
    const legacyItemsToProcess: BillableItem[] = Array.from(legacyBillables.values());
    const mergedLegacyItems: BillableItem[] = legacyItemsToProcess.map(billable => {
        const ticket = tickets.get(billable.id);
        const qty = billable.type === "package" ? (session?.guestCountFinal ?? billable.qty ?? 1) : billable.qty;
        return { ...billable, qty, status: ticket?.status || 'served' };
    });

    const groups: Record<string, GroupedBillableItem> = {};
    mergedLegacyItems.forEach(item => {
        const itemQty = Math.max(1, Number(item.qty) || 1);
        const freeQty = Math.max(0, Math.min(itemQty, item.freeQty ?? (item.isFree ? itemQty : 0)));
        const freeKey = `free:${freeQty}`;

        const chargeableQty = itemQty - freeQty;
        const discountQty = Math.max(0, Math.min(chargeableQty, item.discountQty ?? (item.lineDiscountValue > 0 ? chargeableQty : 0)));
        const discKey = `disc:${item.lineDiscountType}-${item.lineDiscountValue}-q:${discountQty}`;
        
        const voidKey = item.isVoided ? 'voided' : 'active';
        const key = `${voidKey}|${item.status}|${item.type}|${item.itemName}|${item.unitPrice}|${discKey}|${freeKey}`;
        
        if (!groups[key]) {
            groups[key] = { ...item, key, isGrouped: false, totalQty: 0, servedQty: 0, pendingQty: 0, cancelledQty: 0, ticketIds: [], createdAtMin: item.createdAt } as GroupedBillableItem;
        }
        
        groups[key].totalQty += itemQty;
        if (item.status === 'served') groups[key].servedQty += itemQty;
        else if (item.status === 'preparing' || item.status === 'ready') groups[key].pendingQty += itemQty;
        else if (item.status === 'cancelled') groups[key].cancelledQty += itemQty;

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
  }, [billableLines, legacyBillables, tickets, session]);

  const isBillingLocked = session?.status !== 'active' || session?.isPaid;

  const { subtotal, lineDiscountsTotal } = useMemo(() => {
    let sub = 0;
    let lineDisc = 0;

    // New logic for billableLines
    if (billableLines.length > 0) {
        billableLines.forEach(line => {
            if (line.isVoided || line.isFree) return;

            const lineServedQty = line.type === 'package' 
                ? (session?.guestCountFinal ?? line.qty) 
                : getEligibleTicketIds(line, tickets, "served").length;

            if (lineServedQty > 0) {
                const chargeableAmount = lineServedQty * line.unitPrice;
                sub += chargeableAmount;

                if ((line.discountValue ?? 0) > 0) {
                    if (line.discountType === 'percent') {
                        lineDisc += chargeableAmount * (line.discountValue! / 100);
                    } else { // fixed
                        lineDisc += Math.min(line.discountValue! * lineServedQty, chargeableAmount);
                    }
                }
            }
        });
        return { subtotal: sub, lineDiscountsTotal: lineDisc };
    }
    
    // Fallback legacy logic
    const allServedItems = Array.from(legacyBillables.values())
        .filter(billable => !billable.isVoided && (tickets.get(billable.id)?.status === 'served' || (billable.type === 'package' && billable.status !== 'void' && billable.status !== 'cancelled')))
        .map(billable => {
            const qty = billable.type === "package" ? (session?.guestCountFinal ?? billable.qty ?? 1) : (billable.qty ?? 1);
            return {...billable, qty};
        });

    allServedItems.forEach(item => {
        const qty = item.qty;
        const freeQty = Math.max(0, Math.min(qty, item.freeQty ?? (item.isFree ? qty : 0)));
        const chargeableQty = qty - freeQty;

        sub += chargeableQty * item.unitPrice;

        if ((item.lineDiscountValue ?? 0) > 0 && chargeableQty > 0) {
            const discountableQty = Math.max(0, Math.min(chargeableQty, item.discountQty ?? chargeableQty));
            if (item.lineDiscountType === 'percent') {
                lineDisc += (discountableQty * item.unitPrice) * ((item.lineDiscountValue ?? 0) / 100);
            } else {
                lineDisc += Math.min((item.lineDiscountValue ?? 0) * discountableQty, discountableQty * item.unitPrice);
            }
        }
    });
    return { subtotal: sub, lineDiscountsTotal: lineDisc };
}, [billableLines, legacyBillables, tickets, session]);

  const handleUpdateQty = async (ticketIds: string[], newQty: number) => {
    if (isBillingLocked || !activeStore || !session || newQty < 1 || !appUser) return;
    try {
        if (billableLines.length > 0) {
            // New logic: Use billable-lines service
            if (ticketIds.length !== 1) {
                throw new Error("Quantity can only be changed on single-item lines in this mode.");
            }
            const line = billableLines.find(l => l.ticketIds.includes(ticketIds[0]));
            if (!line) throw new Error("Line item not found.");
            
            await changeLineQty(activeStore.id, sessionId, line.id, newQty, appUser, tickets);

        } else {
            // Legacy logic
             const batch = writeBatch(db);
            ticketIds.forEach(id => {
                const ref = doc(db, "stores", activeStore.id, "sessions", sessionId, "billables", id);
                batch.update(ref, { qty: newQty, updatedAt: serverTimestamp() });
            });
            await batch.commit();
        }
        toast({ title: "Quantity Updated" });
    } catch(e: any) {
         toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };
  
  const handleUpdateUnitPrice = async (ticketIds: string[], newPrice: number) => {
    if (isBillingLocked || !appUser || !activeStore || !session) return;
    try {
        const line = billableLines.find(l => l.id === ticketIds[0]); // Here ticketIds[0] is lineId
        if (!line) throw new Error("Line item not found.");

        await moveTicketIdsBetweenLines({
            storeId: activeStore.id,
            sessionId,
            fromLineId: line.id,
            toVariant: { ...line, unitPrice: newPrice },
            ticketIdsToMove: line.ticketIds,
            actorUid: appUser.uid,
        });
        toast({ title: "Unit Price Updated" });
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  const handleApplyDiscount = async (
    ticketIds: string[], // This is the line.id
    discountType: "fixed" | "percent",
    discountValue: number,
    quantity: number
  ) => {
    if (isBillingLocked || !activeStore || !session || !appUser) return;
    try {
        const line = billableLines.find(l => l.id === ticketIds[0]);
        if (!line) throw new Error("Line item not found.");
        
        const eligibleIds = getEligibleTicketIds(line, tickets, "served");
        const targetIds = eligibleIds.slice(0, quantity);

        if(targetIds.length === 0) {
            toast({ variant: "destructive", title: "No items to discount", description: "There are no served items in this line to apply a discount to."});
            return;
        }

        await moveTicketIdsBetweenLines({
            storeId: activeStore.id,
            sessionId,
            fromLineId: line.id,
            toVariant: { ...line, isFree: false, discountType, discountValue },
            ticketIdsToMove: targetIds,
            actorUid: appUser.uid,
        });
        toast({ title: "Discount Applied" });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  const handleApplyFree = async (ticketIds: string[], quantity: number, currentIsFree: boolean) => {
    if (isBillingLocked || !activeStore || !session || !appUser) return;
    try {
        const line = billableLines.find(l => l.id === ticketIds[0]);
        if (!line) throw new Error("Line item not found.");
        
        const eligibleIds = getEligibleTicketIds(line, tickets, "served");
        const targetIds = eligibleIds.slice(0, quantity);

        if(targetIds.length === 0) {
            toast({ variant: "destructive", title: "No items to mark as free", description: "There are no served items in this line."});
            return;
        }

        await moveTicketIdsBetweenLines({
            storeId: activeStore.id,
            sessionId,
            fromLineId: line.id,
            toVariant: { ...line, isFree: !currentIsFree, discountValue: 0, discountType: 'fixed' },
            ticketIdsToMove: targetIds,
            actorUid: appUser.uid,
        });
        toast({ title: currentIsFree ? "Free Status Removed" : "Item Marked as Free" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };


  const handleRemoveDiscount = async (ticketIds: string[]) => {
    if (isBillingLocked || !activeStore || !session || !appUser) return;
    try {
        const line = billableLines.find(l => l.id === ticketIds[0]);
        if (!line) throw new Error("Line item not found.");
        await moveTicketIdsBetweenLines({
            storeId: activeStore.id,
            sessionId,
            fromLineId: line.id,
            toVariant: { ...line, isFree: false, discountValue: 0, discountType: 'fixed' },
            ticketIdsToMove: line.ticketIds,
            actorUid: appUser.uid,
        });
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

  const handleVoidItem = async (ticketId: string, reason: string, note?: string) => {
    if (isBillingLocked || !appUser || !activeStore || !session) return;
    try {
      const line = billableLines.find(l => l.ticketIds.includes(ticketId));
      if (!line) throw new Error("Line item not found for this ticket.");
      await moveTicketIdsBetweenLines({
        storeId: activeStore.id,
        sessionId,
        fromLineId: line.id,
        toVariant: { ...line, isVoided: true, voidReason: reason, voidNote: note },
        ticketIdsToMove: [ticketId],
        actorUid: appUser.uid
      });
      toast({ title: "Item voided" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Void failed", description: e?.message ?? "Unknown error" });
    }
  };
  
  const pendingItemsCount = billableLines.reduce((count, line) => {
    if (line.isVoided) return count;
    return count + getEligibleTicketIds(line, tickets, 'pending').length;
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
        await completePayment(activeStore.id, sessionId, appUser, normalizedPayments, Array.from(legacyBillables.values()), billingSummary, paymentMethods);
        const settingsSnap = await getDoc(doc(db, "stores", activeStore.id, "receiptSettings", "main"));
        const autoPrint = settingsSnap.exists() && !!settingsSnap.data()?.autoPrintAfterPayment;
        toast({ title: "Payment complete", description: "Session closed successfully." });
        router.push(`/receipt/${sessionId}${autoPrint ? "?autoprint=1" : ""}`);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Payment failed", description: err?.message ?? "Something went wrong." });
      setIsCompletingPayment(false); // Only set back to false on failure
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
                    <BillTotals items={Array.from(legacyBillables.values())} adjustments={adjustments} subtotal={subtotal} lineDiscountsTotal={lineDiscountsTotal} billDiscountAmount={billDiscountAmount} grandTotal={grandTotal} totalPaid={totalPaid} onRemoveDiscount={handleRemoveDiscount} />
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
       
       {editingGroup && appUser && (
        <EditBillableItemDialog
            isOpen={!!editingGroup}
            onClose={() => setEditingGroup(null)}
            group={editingGroup}
            discounts={itemDiscounts}
            isLocked={isBillingLocked}
            onUpdateQty={handleUpdateQty}
            onUpdateUnitPrice={handleUpdateUnitPrice}
            onApplyDiscount={handleApplyDiscount}
            onApplyFree={handleApplyFree}
            onVoidItem={handleVoidItem}
        />
      )}
    </div>
  )
}

    