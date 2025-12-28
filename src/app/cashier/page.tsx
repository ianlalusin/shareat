

"use client";

import { useState, useEffect, useMemo } from "react";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { SessionHeader } from "@/components/cashier/session-header";
import { BillableItems, type BillableItem } from "@/components/cashier/billable-items";
import { BillAdjustments, type Adjustment } from "@/components/cashier/bill-adjustments";
import { BillTotals } from "@/components/cashier/bill-totals";
import { PaymentSection, type Payment } from "@/components/cashier/payment-section";
import { useStoreContext } from "@/context/store-context";
import { useAuthContext } from "@/context/auth-context";
import { collection, onSnapshot, query, where, doc, getDocs, Timestamp, addDoc, orderBy, setDoc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { useRouter, useSearchParams } from "next/navigation";
import { startSession, updateKitchenTicketStatus, completePayment } from "@/components/cashier/firestore";
import { Loader2, History, X, ArrowLeft, AlertCircle, Handshake, PackageCheck, PackageX } from "lucide-react";
import { SessionTimelineDrawer } from "@/components/session/session-timeline-drawer";
import { StartSessionForm, type Table } from "@/components/cashier/start-session-form";
import type { StorePackage } from "@/components/manager/store-settings/store-packages-settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ActiveSession, ActiveSessionsGrid } from "@/components/cashier/active-sessions-grid";
import { Product } from "../admin/menu/products/page";
import { type KitchenTicket, OrderItemStatus } from "../kitchen/page";
import { type ModeOfPayment } from "../manager/collections/_components/ModesOfPaymentSettings";
import { type Charge } from "../manager/collections/_components/ChargesSettings";
import { type Discount as StoreDiscount } from "../manager/collections/_components/DiscountsSettings";
import { PastSessionsCard, type PastSession } from "@/components/cashier/past-sessions-card";
import type { StoreFlavor } from "@/components/manager/store-settings/store-packages-settings";
import { type MenuSchedule } from "@/components/manager/store-settings/schedules-settings";
import { isScheduleActiveNow } from "@/components/manager/store-settings/utils/isScheduleActiveNow";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ApprovalQueue } from "@/components/cashier/ApprovalQueue";
import type { StoreAddon } from "@/components/manager/store-settings/addons-settings";
import type { PendingSession } from "@/components/server/pending-tables";


const statusOrder: OrderItemStatus[] = ["preparing", "ready", "served", "cancelled"];

export type GroupedBillableItem = {
    key: string;
    isGrouped: boolean;
    totalQty: number;
    servedQty: number;
    pendingQty: number;
    cancelledQty: number;
    ticketIds: string[];
    createdAtMin: Timestamp | null;
} & Omit<BillableItem, 'id' | 'qty'>;


// --- MOCK DATA & TYPES ---
export type Discount = { type: "percentage" | "fixed"; value: number };

/**
 * Helper function to check if a discount's scope matches the required context (item or bill).
 * It supports both string and array formats for the 'scope' property.
 */
function hasScope(discount: StoreDiscount, scopeKey: "item" | "bill"): boolean {
  const scope = (discount as any).scope;
  if (!scope) return false; // No scope means it's not applicable anywhere.
  if (Array.isArray(scope)) {
    return scope.includes(scopeKey);
  }
  return scope === scopeKey;
}

const REASON_OPTIONS = {
  guest_request: "Guest Request",
  guest_left: "Guest Left",
  additional_guest_arrived: "Additional Guest Arrived",
  item_unavailable: "Item Unavailable",
  other: "Other",
};
type ReasonKey = keyof typeof REASON_OPTIONS;


function SessionDetailView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();

  const [session, setSession] = useState<PendingSession | null>(null);
  const [billables, setBillables] = useState<Map<string, BillableItem>>(new Map());
  const [tickets, setTickets] = useState<Map<string, KitchenTicket>>(new Map());
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [billDiscount, setBillDiscount] = useState<StoreDiscount | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [discounts, setDiscounts] = useState<StoreDiscount[]>([]);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [storeAddons, setStoreAddons] = useState<StoreAddon[]>([]);


  // Listen to Session Doc
  useEffect(() => {
    if (!activeStore) return;

    const sessionRef = doc(db, "stores", activeStore.id, "sessions", sessionId);
    const unsubscribe = onSnapshot(sessionRef, (doc) => {
        if (doc.exists()) {
            const data = doc.data();
            if (data.status === 'closed') {
                toast({ title: "Session Closed", description: "This session has been closed. Redirecting..."});
                router.replace('/cashier');
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
  
  // Listen to Kitchen Tickets Subcollection (Source of Truth for Status)
  useEffect(() => {
      if (!activeStore) return;
      const ticketsRef = collection(db, "stores", activeStore.id, "sessions", sessionId, "kitchentickets");
      const q = query(ticketsRef, orderBy("createdAt", "asc"));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
          const ticketItems = new Map<string, KitchenTicket>();
          snapshot.docs.forEach(docSnap => {
            ticketItems.set(docSnap.id, {
                id: docSnap.id,
                ...(docSnap.data() as Omit<KitchenTicket, 'id'>),
            });
          });
          setTickets(ticketItems);
      });
      return () => unsubscribe();
  }, [sessionId, activeStore]);


  // Listen to Billables Subcollection (Source of Truth for Pricing/Discounts)
  useEffect(() => {
    if (!activeStore) return;

    const billablesRef = collection(db, "stores", activeStore.id, "sessions", sessionId, "billables");
    const q = query(billablesRef, orderBy("createdAt", "asc"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const billablesMap = new Map<string, BillableItem>();
        snapshot.docs.forEach(docSnap => {
            billablesMap.set(docSnap.id, {
                id: docSnap.id,
                ...(docSnap.data() as Omit<BillableItem, 'id'>),
            });
        });
        setBillables(billablesMap);
    });

    return () => unsubscribe();
  }, [sessionId, activeStore]);
  
    // Listen to Store Collections (Payments, Charges, Discounts)
    useEffect(() => {
        if (!activeStore) return;
    
        const unsubs: (() => void)[] = [];
    
        // Modes of Payment
        const mopRef = collection(db, "stores", activeStore.id, "storeModesOfPayment");
        const mopQuery = query(
            mopRef, 
            where("isArchived", "==", false), 
            where("isActive", "==", true),
            orderBy("sortOrder", "asc"),
            orderBy("name", "asc")
        );
        unsubs.push(onSnapshot(mopQuery, (snapshot) => {
            setPaymentMethods(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ModeOfPayment)));
        }));
    
        // Charges
        const chargesRef = collection(db, "stores", activeStore.id, "storeCharges");
        unsubs.push(onSnapshot(query(chargesRef, where("isArchived", "==", false), where("isEnabled", "==", true), orderBy("sortOrder", "asc"), orderBy("name", "asc")), (snapshot) => {
            setCharges(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Charge)));
        }));
    
        // Discounts - Made less strict to allow for missing fields
        const discountsRef = collection(db, "stores", activeStore.id, "storeDiscounts");
        unsubs.push(onSnapshot(query(discountsRef, where("isArchived", "==", false), where("isEnabled", "==", true), orderBy("sortOrder", "asc"), orderBy("name", "asc")), (snapshot) => {
            setDiscounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StoreDiscount)));
        }));
    
        return () => unsubs.forEach(unsub => unsub());
    }, [activeStore]);

    const billableDiscounts = useMemo(() => {
        return discounts.filter(d => {
            const isEnabled = d.isEnabled === true;
            const isArchived = d.isArchived === true;
            return isEnabled && !isArchived && hasScope(d, "bill");
        });
    }, [discounts]);

    const itemDiscounts = useMemo(() => {
        return discounts.filter(d => {
            const isEnabled = d.isEnabled === true;
            const isArchived = d.isArchived === true;
            return isEnabled && !isArchived && hasScope(d, "item");
        });
    }, [discounts]);


  // MERGE tickets and billables into a single source for the UI
    const groupedItems = useMemo<GroupedBillableItem[]>(() => {
        const mergedItems: BillableItem[] = Array.from(billables.values()).map(billable => {
            const ticket = tickets.get(billable.id);
            return {
                ...billable,
                status: ticket?.status || 'served', // Default to served if no ticket
            };
        });

        const groups: Record<string, GroupedBillableItem> = {};

        mergedItems.forEach(item => {
            // Group by item, price, AND free/discount status
            const discountKey = item.isFree ? 'free' : `${item.lineDiscountType}-${item.lineDiscountValue}`;
            const key = `${item.status}|${item.type}|${item.itemName}|${item.unitPrice}|${discountKey}`;
            
            if (!groups[key]) {
                groups[key] = {
                    ...item,
                    key,
                    isGrouped: false,
                    totalQty: 0,
                    servedQty: 0,
                    pendingQty: 0,
                    cancelledQty: 0,
                    ticketIds: [],
                    createdAtMin: item.createdAt,
                };
            }
            
            groups[key].totalQty += item.qty;
            if (item.status === 'served') groups[key].servedQty += item.qty;
            else if (item.status === 'preparing' || item.status === 'ready') groups[key].pendingQty += item.qty;
            else if (item.status === 'cancelled' || item.status === 'void') groups[key].cancelledQty += item.qty;

            groups[key].ticketIds.push(item.id);
            
            const getItemTime = (date: any) => {
                if (!date) return 0;
                // Handle both Firestore Timestamp and JS Date
                return typeof date.toMillis === 'function' ? date.toMillis() : new Date(date).getTime();
            };

            const itemTime = getItemTime(item.createdAt);
            const groupTime = getItemTime(groups[key].createdAtMin);

            if (item.createdAt && (!groups[key].createdAtMin || itemTime < groupTime)) {
                groups[key].createdAtMin = item.createdAt;
            }

            if (groups[key].ticketIds.length > 1) {
                groups[key].isGrouped = true;
            }
        });

        return Object.values(groups).sort((a, b) => {
            const getItemTime = (date: any) => {
                if (!date) return 0;
                return typeof date.toMillis === 'function' ? date.toMillis() : new Date(date).getTime();
            };
            const aTime = getItemTime(a.createdAtMin);
            const bTime = getItemTime(b.createdAtMin);
            return aTime - bTime;
        });

    }, [tickets, billables]);
  
  const isBillingLocked = session?.status !== 'active' || session?.isPaid;

  const handleUpdateQty = async (ticketIds: string[], newQty: number) => {
    if (isBillingLocked || !activeStore || !session) return;
    if (newQty < 1) return;

    const batch = writeBatch(db);
    ticketIds.forEach(ticketId => {
        const ticketRef = doc(db, "stores", activeStore.id, "sessions", sessionId, "kitchentickets", ticketId);
        const billableRef = doc(db, "stores", activeStore.id, "sessions", sessionId, "billables", ticketId);
        batch.update(ticketRef, { qty: newQty });
        batch.update(billableRef, { qty: newQty });
    });
    
    try {
        await batch.commit();
        toast({ title: "Quantity Updated" });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  const handleApplyDiscount = async (ticketIds: string[], discountType: "fixed" | "percentage", discountValue: number, quantity: number) => {
    if (isBillingLocked || !activeStore || !session) return;
    
    const batch = writeBatch(db);
    const ticketsToDiscount = ticketIds.slice(0, quantity);

    ticketsToDiscount.forEach(ticketId => {
        const billableRef = doc(db, "stores", activeStore.id, "sessions", sessionId, "billables", ticketId);
        batch.update(billableRef, {
            lineDiscountType: discountType,
            lineDiscountValue: discountValue,
            isFree: false, // Applying a discount removes the 'free' status
            updatedAt: serverTimestamp()
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
        // If currentIsFree is true, we apply to all tickets to undo. Otherwise, apply to specified quantity.
        const ticketsToToggle = currentIsFree ? ticketIds : ticketIds.slice(0, quantity);
        const newIsFree = !currentIsFree;

        ticketsToToggle.forEach(ticketId => {
            const billableRef = doc(db, "stores", activeStore.id, "sessions", sessionId, "billables", ticketId);
            batch.update(billableRef, {
                isFree: newIsFree,
                lineDiscountValue: 0, // Clear any discount when toggling free status
                updatedAt: serverTimestamp()
            });
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
        const billableRef = doc(db, "stores", activeStore.id, "sessions", sessionId, "billables", ticketId);
        batch.update(billableRef, {
            lineDiscountType: "fixed",
            lineDiscountValue: 0,
            isFree: false,
            updatedAt: serverTimestamp()
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
      if (isBillingLocked) return;
      if (!appUser || !activeStore || !session) return;
      
      try {
          await updateKitchenTicketStatus(activeStore.id, sessionId, itemId, newStatus, appUser, reason);
          toast({ title: 'Item Updated', description: `Item has been marked as ${newStatus}.` });
      } catch (error: any) {
          toast({ variant: 'destructive', title: 'Update Failed', description: error.message });
      }
  }

  // --- BILLING CALCULATIONS ---
  const allServedItems: BillableItem[] = Array.from(billables.values())
    .filter(billable => {
        const ticket = tickets.get(billable.id);
        return ticket?.status === 'served' || (billable.type === 'package' && billable.status !== 'void' && billable.status !== 'cancelled');
    })
    .map(billable => {
        const qty = billable.type === 'package' ? (session.guestCountFinal ?? billable.qty) : billable.qty;
        return { ...billable, qty };
    });

  const pendingItems = Array.from(tickets.values()).filter(t => t.status === "preparing" || t.status === 'ready');
  
  const subtotal = allServedItems
    .filter(item => !item.isFree)
    .reduce((total, item) => total + (item.qty * item.unitPrice), 0);

  const lineDiscountsTotal = allServedItems
    .filter(item => !item.isFree)
    .reduce((total, item) => {
      const lineTotal = item.qty * item.unitPrice;
      if (item.lineDiscountType === 'percentage') {
        return total + (lineTotal * (item.lineDiscountValue / 100));
      }
      return total + Math.min(item.lineDiscountValue, lineTotal);
    }, 0);


  const discountedSubtotal = subtotal - lineDiscountsTotal;
  
  const billDiscountAmount = billDiscount
    ? (billDiscount.type === 'percentage'
        ? discountedSubtotal * (billDiscount.value / 100)
        : Math.min(billDiscount.value, discountedSubtotal))
    : 0;
  
  const netSubtotalAfterDiscounts = Math.max(0, discountedSubtotal - billDiscountAmount);

    const addAdjustment = (charge: Charge) => {
        if (isBillingLocked) return;
        const chargeAmount = charge.type === 'fixed' 
            ? charge.value 
            : netSubtotalAfterDiscounts * (charge.value / 100);

        setAdjustments(prev => [...prev, {
            id: `adj-${Date.now()}`,
            note: charge.name,
            amount: chargeAmount,
            source: 'charge',
            sourceId: charge.id,
        }]);
    };

  
  const handleAddCustomAdjustment = (note: string, amount: number) => {
    if (isBillingLocked) return;
    if (!note || amount <= 0) {
        toast({ variant: 'destructive', title: 'Invalid Custom Charge', description: 'Please provide a valid note and amount.' });
        return;
    }
    setAdjustments(prev => [...prev, {
        id: `adj-custom-${Date.now()}`,
        note,
        amount,
        source: 'custom',
    }]);
    toast({ title: 'Custom Charge Added' });
  };
  const adjustmentsTotal = adjustments.reduce((total, adj) => total + adj.amount, 0);

  const grandTotal = netSubtotalAfterDiscounts + adjustmentsTotal;

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = grandTotal - totalPaid;
  const change = totalPaid > grandTotal ? totalPaid - grandTotal : 0;
  
  const canCompletePayment = remainingBalance <= 0 && payments.length > 0 && pendingItems.length === 0 && allServedItems.length > 0;

  const handleCompletePayment = async () => {
    if (!appUser || !activeStore || !session || !canCompletePayment) return;
    
    setIsCompleting(true);
    try {
      await completePayment(
        activeStore.id,
        sessionId,
        session.tableId,
        appUser,
        payments,
        {
          subtotal,
          lineDiscountsTotal,
          billDiscountAmount,
          adjustmentsTotal,
          grandTotal,
        }
      );
      toast({
        title: "Payment Complete",
        description: `Session for Table ${session.tableNumber} has been closed.`,
      });
      // The redirect will happen automatically via the session listener
    } catch (error: any) {
      console.error("Payment completion failed:", error);
      toast({
        variant: "destructive",
        title: "Payment Failed",
        description: error.message || "An unexpected error occurred.",
      });
    } finally {
      setIsCompleting(false);
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
            id: session.id,
            tableNumber: session.tableNumber,
            guestCount: session.guestCountFinal || 0,
            packageName: session.packageSnapshot?.name || 'N/A',
            sessionMode: session.sessionMode,
            customer: session.customer,
        }} />
        <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={() => setIsTimelineOpen(true)}>
                <History className="mr-2 h-4 w-4" />
                View Timeline
            </Button>
        </div>
      </header>
      
      <main className="flex-1 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 h-full">
            {/* Left Panel: Receipt Preview */}
            <div className="md:col-span-1 xl:col-span-2 bg-muted/20 h-full flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                    <BillTotals
                        items={allServedItems}
                        adjustments={adjustments}
                        subtotal={subtotal}
                        lineDiscountsTotal={lineDiscountsTotal}
                        billDiscountAmount={billDiscountAmount}
                        grandTotal={grandTotal}
                        totalPaid={totalPaid}
                        onRemoveDiscount={handleRemoveDiscount}
                    />
                </div>
                <BillAdjustments
                    adjustments={adjustments}
                    billDiscount={billDiscount}
                    charges={charges}
                    discounts={billableDiscounts}
                    onAddAdjustment={addAdjustment}
                    onAddCustomAdjustment={handleAddCustomAdjustment}
                    onRemoveAdjustment={(id) => setAdjustments(prev => prev.filter(adj => adj.id !== id))}
                    onSetBillDiscount={setBillDiscount}
                    isLocked={isBillingLocked}
                />
            </div>


            {/* Right Panel: Editable Bill */}
            <div className="md:col-span-1 xl:col-span-3 p-4 h-full flex flex-col gap-4 overflow-y-auto">
                <BillableItems 
                    groupedItems={groupedItems}
                    storeId={activeStore.id}
                    session={session}
                    discounts={itemDiscounts}
                    onUpdateQty={handleUpdateQty}
                    onApplyDiscount={handleApplyDiscount}
                    onApplyFree={handleApplyFree}
                    onStatusUpdate={handleCashierItemStatusUpdate}
                    isLocked={isBillingLocked}
                />
                <PaymentSection 
                    paymentMethods={paymentMethods}
                    payments={payments}
                    setPayments={setPayments}
                    totalPaid={totalPaid}
                    remainingBalance={remainingBalance}
                    change={change}
                    isLocked={isBillingLocked}
                />
                 <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm py-3 rounded-lg mt-auto">
                    {pendingItems.length > 0 && (
                        <Alert variant="default" className="mb-2">
                           <AlertCircle className="h-4 w-4" />
                           <AlertTitle>Pending Items</AlertTitle>
                           <AlertDescription>
                                {pendingItems.length} item(s) are still in the kitchen. Payment is blocked until all items are served or voided.
                           </AlertDescription>
                        </Alert>
                    )}
                    <Button 
                        type="button"
                        className="w-full" 
                        size="lg" 
                        disabled={!canCompletePayment || isBillingLocked || isCompleting} 
                        onClick={handleCompletePayment}
                    >
                        {isCompleting ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Completing...</>
                        ) : isBillingLocked ? (
                            'Payment Finalized'
                        ) : (
                            'Complete Payment'
                        )}
                    </Button>
                </div>
            </div>
        </div>
      </main>

       {isTimelineOpen && (
        <SessionTimelineDrawer
            open={isTimelineOpen}
            onOpenChange={setIsTimelineOpen}
            storeId={activeStore.id}
            sessionId={sessionId!}
        />
       )}
    </div>
  )
}

function SessionListView() {
    const { appUser } = useAuthContext();
    const { activeStore } = useStoreContext();
    const router = useRouter();

    const [tables, setTables] = useState<Table[]>([]);
    const [packages, setPackages] = useState<StorePackage[]>([]);
    const [flavors, setFlavors] = useState<StoreFlavor[]>([]);
    const [schedules, setSchedules] = useState<Map<string, MenuSchedule>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
    const [sessions, setSessions] = useState<ActiveSession[]>([]);

    useEffect(() => {
        if (!activeStore) {
            setIsLoading(false);
            return;
        };
        setIsLoading(true);

        const unsubs: (()=>void)[] = [];

        // Fetch Tables
        const tablesRef = collection(db, "stores", activeStore.id, "tables");
        unsubs.push(onSnapshot(query(tablesRef, where("isActive", "==", true)), (snapshot) => {
            setTables(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Table))
                .sort((a,b) => (a.tableNumber || "0").localeCompare(b.tableNumber || "0", undefined, { numeric: true }))
            );
        }));

        // Fetch Flavors from store-level collection
        const flavorsRef = collection(db, "stores", activeStore.id, "storeFlavors");
        unsubs.push(onSnapshot(query(flavorsRef, where("isEnabled", "==", true), orderBy("sortOrder", "asc")), (snapshot) => {
            setFlavors(snapshot.docs.map(doc => doc.data() as StoreFlavor));
        }));

        // Fetch Packages from store-level collection
        const packagesRef = collection(db, "stores", activeStore.id, "storePackages");
        unsubs.push(onSnapshot(query(packagesRef, where("isEnabled", "==", true), orderBy("sortOrder", "asc")), (snapshot) => {
            setPackages(snapshot.docs.map(doc => ({ ...doc.data() } as StorePackage)));
        }));

        // Fetch active schedules
        const schedulesRef = collection(db, "stores", activeStore.id, "menuSchedules");
        const schedulesQuery = query(schedulesRef, where("isActive", "==", true));
        unsubs.push(onSnapshot(schedulesQuery, (snapshot) => {
            const schedulesMap = new Map<string, MenuSchedule>();
            snapshot.docs.forEach(doc => schedulesMap.set(doc.id, { id: doc.id, ...doc.data() } as MenuSchedule));
            setSchedules(schedulesMap);
        }));
        
        // Fetch active and pending sessions, sorted by start time
        const sessionsQuery = query(
            collection(db, "stores", activeStore.id, "sessions"), 
            where("status", "in", ["active", "pending_verification"]),
            orderBy("startedAt", "asc")
        );
        unsubs.push(onSnapshot(sessionsQuery, (snapshot) => {
            setSessions(snapshot.docs.map(d => d.data() as ActiveSession))
        }));

        // Fetch past sessions for the day
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const pastSessionsQuery = query(
            collection(db, "stores", activeStore.id, "sessions"),
            where("status", "==", "closed"),
            where("closedAt", ">=", Timestamp.fromDate(todayStart)),
            where("closedAt", "<=", Timestamp.fromDate(todayEnd)),
            orderBy("closedAt", "desc")
        );
        unsubs.push(onSnapshot(pastSessionsQuery, (snapshot) => {
            setPastSessions(snapshot.docs.map(doc => doc.data() as PastSession));
        }));
        
        // Use Promise.all to set loading to false only after initial fetches setup
        const initialFetches = [
            getDocs(tablesRef),
            getDocs(flavorsRef),
            getDocs(packagesRef),
            getDocs(schedulesQuery),
            getDocs(sessionsQuery),
        ];

        Promise.all(initialFetches).finally(() => setIsLoading(false));


        return () => {
            unsubs.forEach(unsub => unsub());
        };

    }, [activeStore]);

    const availablePackages = useMemo(() => {
        return packages.filter(pkg => {
            const isPkgEnabled = (pkg.isEnabled ?? true) === true;
            if (!isPkgEnabled) return false;

            if (!pkg.menuScheduleId) return true; 
            const schedule = schedules.get(pkg.menuScheduleId);
            if (!schedule) return false; 
            return isScheduleActiveNow(schedule);
        });
    }, [packages, schedules]);


    if (!activeStore) {
      return (
          <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Please select a store to begin.</p>
          </div>
      );
    }

    return (
        <>
            <PageHeader title="Cashier" description="Start a new session or manage active ones." />
            
            {isLoading ? <Loader2 className="animate-spin" /> : (
                <div className="space-y-8">
                    <ApprovalQueue storeId={activeStore.id} />
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                        <div className="lg:col-span-1 space-y-8">
                            <StartSessionForm
                                tables={tables.filter(t => t.status === 'available')}
                                packages={availablePackages}
                                flavors={flavors}
                                user={appUser}
                                storeId={activeStore.id}
                            />
                        </div>
                        <div className="lg:col-span-2 space-y-8">
                            <ActiveSessionsGrid sessions={sessions} />
                            <PastSessionsCard sessions={pastSessions} />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default function CashierPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      {sessionId ? <SessionDetailView sessionId={sessionId} /> : <SessionListView />}
    </RoleGuard>
  );
}





    


