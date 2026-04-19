
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { isDiscountDateActive } from "@/lib/collections/globalCollections";
import { collection, onSnapshot, query, doc, orderBy, updateDoc, serverTimestamp, runTransaction, increment, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { updateSessionBillLine, removeLineAdjustment, getActorStamp, createKitchenTickets } from "@/components/cashier/firestore";
import { Loader2, History, ArrowLeft, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionHeader } from "@/components/cashier/session-header";
import { BillableItems } from "@/components/cashier/billable-items";
import { BillTotals } from "@/components/cashier/bill-totals";
import { BillAdjustments } from "@/components/cashier/bill-adjustments";
import { PaymentModal } from "@/components/cashier/payment-modal";
import { CustomerInfoForm } from "@/components/cashier/customer-info-form";
import { SessionTimelineDrawer } from "@/components/session/session-timeline-drawer";
import { useConfirmDialog } from "../global/confirm-dialog";
import type { PendingSession, Charge, Discount, SessionBillLine, Adjustment, LineAdjustment } from "@/lib/types";
import { calculateBillTotals } from "@/lib/tax";
import { EditBillableItemDialog } from "./edit-billable-item-dialog";
import { writeActivityLog } from "./activity-log";
import { useStoreConfigDoc } from "@/hooks/useStoreConfigDoc";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";


export function SessionDetailView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { user, appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { Dialog } = useConfirmDialog();
  const isMobile = useIsMobile();

  const { config: storeConfig, isLoading: isConfigLoading } = useStoreConfigDoc(activeStore?.id);

  const [session, setSession] = useState<PendingSession | null>(null);
  const [billLines, setBillLines] = useState<SessionBillLine[]>([]);
  
  const [billDiscount, setBillDiscount] = useState<Discount | null>(null);
  const [customAdjustments, setCustomAdjustments] = useState<Adjustment[]>([]);

  const [isLoadingSession, setIsLoadingSession] = useState(true);

  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  
  const [editingLineId, setEditingLineId] = useState<string | null>(null);

  const editingLine = useMemo(() => {
    if (!editingLineId) return null;
    return billLines.find(line => line.id === editingLineId) || null;
  }, [billLines, editingLineId]);

  const storeId = activeStore?.id;

  const paymentMethods = useMemo(() => {
    if (!storeConfig?.modesOfPayment) return [];
    return storeConfig.modesOfPayment.filter(m => m.isActive && !(m as any).isArchived);
  }, [storeConfig]);

  const charges = useMemo(() => {
    if (!storeConfig?.charges) return [];
    return storeConfig.charges.filter(c => c.isEnabled && !(c as any).isArchived);
  }, [storeConfig]);

  const billCharges = useMemo(
    () =>
      charges.filter(c => {
        const scope = (c as any).scope;
        if (!scope) return true; // legacy charges default to bill
        const arr = Array.isArray(scope) ? scope : [scope];
        return arr.includes("bill");
      }),
    [charges],
  );
  const itemCharges = useMemo(
    () =>
      charges.filter(c => {
        const scope = (c as any).scope;
        if (!scope) return false; // legacy defaults to bill-only → not in item list
        const arr = Array.isArray(scope) ? scope : [scope];
        return arr.includes("item");
      }),
    [charges],
  );

  const discounts = useMemo(() => {
    if (!storeConfig?.discounts) return [];
    return storeConfig.discounts.filter(d =>
      d.isEnabled && !(d as any).isArchived && isDiscountDateActive(d as any),
    );
  }, [storeConfig]);


  useEffect(() => {
    if (!storeId) return;
    const sessionRef = doc(db, "stores", storeId, "sessions", sessionId);
    const unsubscribe = onSnapshot(sessionRef, (doc) => {
        if (doc.exists()) {
            const data = doc.data();
            setSession({ id: doc.id, ...data } as PendingSession);
            setBillDiscount((data.billDiscount as Discount | null | undefined) ?? null);
            setCustomAdjustments(Array.isArray(data.customAdjustments) ? (data.customAdjustments as Adjustment[]) : []);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: 'Session not found.' });
            router.replace('/cashier');
        }
        setIsLoadingSession(false);
    }, (error) => {
      console.error("Error fetching session:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not load session data.' });
      router.replace('/cashier');
      setIsLoadingSession(false);
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
        console.debug(`[GuestSync] Re-syncing package qty to ${session.guestCountFinal}.`);
        const beforeQty = packageLine.qtyOrdered;
        const afterQty = session.guestCountFinal || packageLine.qtyOrdered;
        updateSessionBillLine(storeId, sessionId, packageLine.id, {
          qtyOrdered: afterQty,
          qtyOverrideActive: false,
          qtyLastSyncedApprovedAt: approvedAt.toString(),
        }, appUser).then(() => {
          writeActivityLog({
            action: "PACKAGE_QTY_RESYNC_APPROVED_CHANGE",
            meta: { itemName: packageLine.itemName, beforeQty, afterQty },
            note: `Package qty auto-synced from ${beforeQty} to ${afterQty} (guest count approved)`,
            storeId, sessionId, user: appUser,
            sessionContext: { sessionStatus: session.status, sessionStartedAt: session.startedAt, sessionMode: session.sessionMode, customerName: session.customer?.name ?? session.customerName, tableNumber: session.tableNumber, tableDisplayName: session.tableDisplayName ?? null },
          });
        }).catch(err => console.error("Failed to re-sync package qty after approval:", err));
      }
    } else {
      // No current approval. If no override is active, ensure qty matches final count.
      // This handles initial load and any other state corrections.
      if (!packageLine.qtyOverrideActive && session.guestCountFinal !== null && packageLine.qtyOrdered !== session.guestCountFinal) {
        console.debug(`[GuestSync] Aligning package qty to ${session.guestCountFinal}.`);
        updateSessionBillLine(storeId, sessionId, packageLine.id, {
          qtyOrdered: session.guestCountFinal
        }, appUser).catch(err => console.error("Failed to align package quantity:", err));
      }
    }
  }, [session, billLines, appUser, storeId, sessionId]);
  
  const billableDiscounts = useMemo(() => discounts.filter(d => Array.isArray(d.scope) ? d.scope.includes("bill") : d.scope === "bill"), [discounts]);
  const itemDiscounts = useMemo(() => discounts.filter(d => Array.isArray(d.scope) ? d.scope.includes("item") : d.scope === "item"), [discounts]);
  
  const isBillingLocked = session?.status !== 'active' || session?.isPaid;

  const billTotals = useMemo(() => {
    return calculateBillTotals(billLines, activeStore, billDiscount, customAdjustments);
  }, [billLines, activeStore, billDiscount, customAdjustments]);
  
  const { grandTotal } = billTotals;

  const updateSessionBillingState = async (patch: { billDiscount?: Discount | null; customAdjustments?: Adjustment[] }) => {
    if (!storeId || !sessionId) return;
    const sessionRef = doc(db, "stores", storeId, "sessions", sessionId);
    await updateDoc(sessionRef, {
      ...patch,
      billingRevision: increment(1),
      updatedAt: serverTimestamp(),
    });
  };

  const handleUpdateLine = async (lineId: string, before: Partial<SessionBillLine>, after: Partial<SessionBillLine>) => {
    if (!appUser || !storeId || !sessionId || !session) return;
    try {
        await runTransaction(db, async (tx) => {
            const lineRef = doc(db, 'stores', storeId, 'sessions', sessionId, 'sessionBillLines', lineId);
            const sessionRef = doc(db, 'stores', storeId, 'sessions', sessionId);
            const actor = getActorStamp(appUser);

            const updatePayload = {
                ...after,
                updatedAt: serverTimestamp(),
                updatedByUid: actor.uid,
                updatedByName: actor.username,
            };
            tx.update(lineRef, updatePayload);
            tx.update(sessionRef, { billingRevision: increment(1), updatedAt: serverTimestamp() });

            const line = billLines.find(l => l.id === lineId);
            if (!line) throw new Error("Line item not found in local state.");
            
            const diffQty = (after.qtyOrdered ?? 0) - (before.qtyOrdered ?? 0);

            if (line.type === 'addon' && diffQty > 0) {
                const klId = line.kitchenLocationId;
                if (klId) {
                    await createKitchenTickets(db, storeId, sessionId, session, 'addon', {
                        billLineId: line.id,
                        itemId: line.itemId,
                        itemName: line.itemName,
                        kitchenLocationId: klId,
                        kitchenLocationName: line.kitchenLocationName,
                    }, diffQty, actor, { tx });
                } else {
                    console.warn(`[Kitchen] No location set for addon "${line.itemName}" — kitchen ticket was NOT created.`);
                }
            }
        });

        // Logging and UI feedback outside the transaction
        const line = billLines.find(l => l.id === lineId);
        if (!line) return;

        const diff = {
            qtyOrdered: (after.qtyOrdered ?? 0) - (before.qtyOrdered ?? 0),
            discount: (after.discountQty ?? 0) - (before.discountQty ?? 0),
            free: (after.freeQty ?? 0) - (before.freeQty ?? 0),
            void: (after.voidedQty ?? 0) - (before.voidedQty ?? 0),
        };
        
        const unitPrice = Number.isFinite(Number(line.unitPrice)) ? Number(line.unitPrice) : 0;
        const sessionContext = {
            sessionStatus: session.status,
            sessionStartedAt: session.startedAt,
            sessionMode: session.sessionMode,
            customerName: session.customer?.name ?? session.customerName,
            tableNumber: session.tableNumber,
        };

        if (line.type === 'package' && diff.qtyOrdered > 0) {
            await writeActivityLog({ action: "PACKAGE_QTY_OVERRIDE_SET", meta: { itemName: line.itemName, beforeQty: before.qtyOrdered, afterQty: after.qtyOrdered }, storeId, sessionId, user: appUser, sessionContext });
        }
        
        if (diff.discount > 0) {
            await writeActivityLog({ action: "DISCOUNT_APPLIED", qty: diff.discount, meta: { itemName: line.itemName }, storeId, sessionId, user: appUser, sessionContext });
        } else if (diff.discount < 0) {
            await writeActivityLog({ action: "DISCOUNT_REMOVED", qty: -diff.discount, meta: { itemName: line.itemName }, storeId, sessionId, user: appUser, sessionContext });
        }

        if (diff.free > 0) {
          await writeActivityLog({
            action: "MARK_FREE",
            qty: diff.free,
            note: "Marked item free",
            meta: {
              itemId: line.id,
              itemName: line.itemName,
              qty: Math.abs(diff.free),
              unitPriceAfter: unitPrice,
              amount: Math.abs(diff.free) * unitPrice,
            },
            storeId, sessionId, user: appUser, sessionContext
          });
        } else if (diff.free < 0) {
          await writeActivityLog({
            action: "UNMARK_FREE",
            qty: -diff.free,
            note: "Removed free tag",
            meta: {
              itemId: line.id,
              itemName: line.itemName,
              qty: Math.abs(diff.free),
              unitPriceAfter: unitPrice,
              amount: Math.abs(diff.free) * unitPrice,
            },
            storeId, sessionId, user: appUser, sessionContext
          });
        }
        
        if (diff.void > 0) {
          await writeActivityLog({
            action: "VOID_TICKETS",
            qty: diff.void,
            note: "Voided item",
            meta: {
              itemId: line.id,
              itemName: line.itemName,
              qty: Math.abs(diff.void),
              unitPriceAfter: unitPrice,
              amount: Math.abs(diff.void) * unitPrice,
            },
            storeId, sessionId, user: appUser, sessionContext
          });
        } else if (diff.void < 0) {
          await writeActivityLog({
            action: "UNVOID",
            qty: -diff.void,
            note: "Unvoided item",
            meta: {
              itemId: line.id,
              itemName: line.itemName,
              qty: Math.abs(diff.void),
              unitPriceAfter: unitPrice,
              amount: Math.abs(diff.void) * unitPrice,
            },
            storeId, sessionId, user: appUser, sessionContext
          });
        }

        toast({ title: "Line Item Updated"});
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
        throw e;
    }
  }

  const handleAddLineAdjustment = async (lineId: string, adj: LineAdjustment) => {
    if (!appUser || !storeId || !sessionId || !activeStore || !session) return;
    try {
        const lineRef = doc(db, 'stores', storeId, 'sessions', sessionId, 'sessionBillLines', lineId);
        const sessionRef = doc(db, 'stores', storeId, 'sessions', sessionId);
        const batch = writeBatch(db);
        batch.update(lineRef, {
            [`lineAdjustments.${adj.id}`]: adj,
        });
        batch.update(sessionRef, {
            billingRevision: increment(1),
            updatedAt: serverTimestamp(),
        });
        await batch.commit();
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
                    sessionContext: {
                        sessionStatus: session.status,
                        sessionStartedAt: session.startedAt,
                        sessionMode: session.sessionMode,
                        customerName: session.customer?.name ?? session.customerName,
                        tableNumber: session.tableNumber,
                        tableDisplayName: session.tableDisplayName ?? null,
                    },
                    meta: {
                        itemId: line.id,
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
        throw e;
    }
  }

  const handleRemoveLineAdjustment = async (lineId: string, adjId: string) => {
    if (!activeStore?.id || !sessionId || !appUser || !session) return;
    const line = billLines.find(l => l.id === lineId);
    const adj = line ? Object.values((line as any).lineAdjustments ?? {}).find((a: any) => a.id === adjId) as any : null;
    await removeLineAdjustment(activeStore.id, sessionId, lineId, adjId, appUser);
    if (adj) {
      writeActivityLog({
        action: "DISCOUNT_REMOVED",
        note: `Removed ${adj.kind ?? "adjustment"}: ${adj.name || adj.type || ""}`,
        meta: { itemName: line?.itemName, discountName: adj.name || adj.type, discountType: adj.type, discountValue: adj.value },
        storeId: activeStore.id, sessionId, user: appUser,
        sessionContext: { sessionStatus: session.status, sessionStartedAt: session.startedAt, sessionMode: session.sessionMode, customerName: session.customer?.name ?? session.customerName, tableNumber: session.tableNumber, tableDisplayName: session.tableDisplayName ?? null },
      });
    }
  };


  const isLoading = isLoadingSession || isConfigLoading;

  const BillSummaryContent = (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto">
        {session && <CustomerInfoForm session={session} />}
        <BillTotals
          lines={billLines}
          store={activeStore!}
          billDiscount={billDiscount}
          customAdjustments={customAdjustments}
          totalPaid={0}
          isLocked={isBillingLocked}
          onRemoveLineAdjustment={handleRemoveLineAdjustment}
        />
      </div>
      <BillAdjustments
        appUser={appUser}
        charges={billCharges}
        discounts={billableDiscounts}
        onAddAdjustment={async (charge: Charge) => {
          const next = [...customAdjustments, {id: charge.id, note: charge.name, amount: charge.value, type: charge.type, source: 'charge' as const, sourceId: charge.id, appliesTo: charge.appliesTo}];
          await updateSessionBillingState({ customAdjustments: next });
          setCustomAdjustments(next);
          if (storeId && sessionId && appUser) writeActivityLog({ action: "CUSTOM_CHARGE_ADDED", storeId, sessionId, user: appUser, note: `Charge added: ${charge.name} ${charge.type === 'percent' ? charge.value + '%' : '₱' + charge.value}`, meta: { itemName: charge.name, amount: charge.value, discountType: charge.type } });
        }}
        onAddCustomAdjustment={async (note, amount) => {
          const next = [...customAdjustments, {id: `custom_${Date.now()}`, note, amount, type: 'fixed' as const, source: 'custom' as const}];
          await updateSessionBillingState({ customAdjustments: next });
          setCustomAdjustments(next);
          if (storeId && sessionId && appUser) writeActivityLog({ action: "CUSTOM_CHARGE_ADDED", storeId, sessionId, user: appUser, note: `Custom charge: ${note} ₱${amount}`, meta: { itemName: note, amount } });
        }}
        onRemoveAdjustment={async (id) => {
          const adj = customAdjustments.find(a => a.id === id);
          const next = customAdjustments.filter(a => a.id !== id);
          await updateSessionBillingState({ customAdjustments: next });
          setCustomAdjustments(next);
          if (storeId && sessionId && appUser && adj) writeActivityLog({ action: "CUSTOM_CHARGE_REMOVED", storeId, sessionId, user: appUser, note: `Charge removed: ${adj.note} ₱${adj.amount}`, meta: { itemName: adj.note, amount: adj.amount } });
        }}
        onSetBillDiscount={async (d) => {
          const wasDiscount = !!billDiscount;
          await updateSessionBillingState({ billDiscount: d });
          setBillDiscount(d);
          if (storeId && sessionId && appUser) {
            if (d) writeActivityLog({ action: "BILL_DISCOUNT_APPLIED", storeId, sessionId, user: appUser, note: `Bill discount: ${d.name} (${d.type === 'percent' ? d.value + '%' : '₱' + d.value})`, meta: { discountName: d.name, discountType: d.type, discountValue: d.value } });
            else if (wasDiscount) writeActivityLog({ action: "BILL_DISCOUNT_REMOVED", storeId, sessionId, user: appUser, note: "Bill discount removed" });
          }
        }}
        billDiscount={billDiscount}
        adjustments={customAdjustments || []}
        isLocked={isBillingLocked}
      />
    </div>
  );

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
            linkedCustomerName: (session as any).linkedCustomerName ?? null,
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
            <div className="md:col-span-1 xl:col-span-2 bg-muted/20 md:h-full flex flex-col overflow-hidden">
                {isMobile ? (
                  <Accordion type="single" collapsible className="w-full" defaultValue="bill-summary">
                    <AccordionItem value="bill-summary" className="border-b-0">
                      <AccordionTrigger className="p-4 text-lg font-semibold">
                        Bill Summary
                      </AccordionTrigger>
                      <AccordionContent>
                        {BillSummaryContent}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ) : (
                  BillSummaryContent
                )}
            </div>
            <div className="md:col-span-1 xl:col-span-3 p-4 h-full flex flex-col gap-4 overflow-y-auto">
                <BillableItems 
                    lines={billLines}
                    storeId={storeId} 
                    session={session} 
                    discounts={itemDiscounts}
                    isLocked={isBillingLocked}
                    onUpdateLine={(line) => setEditingLineId(line.id)}
                    onAddLine={(newLine) => {
                        setBillLines((currentLines) => {
                            // Check if an identical addon line already exists
                            const existingLineIndex = currentLines.findIndex(
                                (l) => l.type === 'addon' && l.itemId === newLine.itemId && l.unitPrice === newLine.unitPrice
                            );

                            if (existingLineIndex >= 0) {
                                // If it exists, update the quantity
                                const nextLines = [...currentLines];
                                const existingLine = nextLines[existingLineIndex];
                                nextLines[existingLineIndex] = {
                                    ...existingLine,
                                    qtyOrdered: (existingLine.qtyOrdered ?? 0) + (newLine.qtyOrdered ?? 0),
                                };
                                return nextLines;
                            } else {
                                // If it doesn't exist, add the new line
                                return [...currentLines, newLine];
                            }
                        });
                    }}
                />
                <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm py-3 rounded-lg mt-auto">
                    <Button type="button" className="w-full" size="lg" disabled={isBillingLocked || grandTotal <= 0} onClick={() => setIsPaymentOpen(true)}>
                        {isBillingLocked ? "Payment Finalized" : `Pay ₱${grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
            charges={itemCharges}
            isLocked={isBillingLocked}
            onSave={handleUpdateLine}
            onAddLineAdjustment={handleAddLineAdjustment}
        />
      )}
      {Dialog}

      {session && appUser && activeStore && storeId && (
        <PaymentModal
          open={isPaymentOpen}
          onOpenChange={setIsPaymentOpen}
          grandTotal={grandTotal}
          sessionId={sessionId}
          storeId={storeId}
          activeStore={activeStore}
          appUser={appUser}
          firebaseUser={user ?? null}
          paymentMethods={paymentMethods}
        />
      )}
    </div>
  )
}
