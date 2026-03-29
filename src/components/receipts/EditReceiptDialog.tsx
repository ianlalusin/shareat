"use client";

import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { BillableItems } from "../cashier/billable-items";
import { BillTotals } from "../cashier/bill-totals";
import { BillAdjustments } from "../cashier/bill-adjustments";
import { PaymentSection } from "../cashier/payment-section";
import { EditBillableItemDialog } from "../cashier/edit-billable-item-dialog";
import type { Receipt, Discount, Charge, Payment, SessionBillLine, ModeOfPayment, Store, Adjustment, PendingSession, ReceiptAnalyticsV2, LineAdjustment } from "@/lib/types";
import { calculateBillTotals } from "@/lib/tax";
import { Loader2 } from "lucide-react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { useAuthContext } from "@/context/auth-context";
import { writeActivityLog } from "../cashier/activity-log";

interface EditReceiptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: Receipt;
  store: Store;
  discounts: Discount[];
  charges: Charge[];
  paymentMethods: ModeOfPayment[];
  onSave: (updatedReceiptData: Partial<Receipt>, editReason: string) => Promise<void>;
}

function EditReceiptContent({
  receipt,
  store,
  discounts,
  charges,
  paymentMethods,
  onSave,
  onClose,
}: EditReceiptDialogProps) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editReason, setEditReason] = useState("");

  // Editable state
  const [customerName, setCustomerName] = useState(receipt.customerName || "");
  const [customerTin, setCustomerTin] = useState(receipt.customerTin || "");
  const [customerAddress, setCustomerAddress] = useState(receipt.customerAddress || "");
  const [lines, setLines] = useState<SessionBillLine[]>(() => JSON.parse(JSON.stringify(receipt.lines || [])));
  const [billDiscount, setBillDiscount] = useState<Discount | null>(() => receipt.billDiscount ?? null);
  const [customAdjustments, setCustomAdjustments] = useState<Adjustment[]>(() => receipt.customAdjustments ?? []);
  const [payments, setPayments] = useState<Payment[]>(() => {
    return Object.entries(receipt.analytics?.mop || {}).map(([key, value], i) => ({
      id: `payment-${i}`,
      methodId: paymentMethods.find(pm => pm.name === key)?.id || 'unknown',
      amount: value as number,
    }));
  });

  const [editingLine, setEditingLine] = useState<SessionBillLine | null>(null);
  
  const handleAddLineAdjustment = (lineId: string, adj: LineAdjustment) => {
    setLines(cur => cur.map(l => {
      if (l.id !== lineId) return l;
      const next = { ...(l as any) };
      const map = { ...(next.lineAdjustments ?? {}) };
      map[adj.id] = adj;
      next.lineAdjustments = map;
      return next;
    }));
    setEditingLine(null);
  };
  
  const handleRemoveLineAdjustment = (lineId: string, adjId: string) => {
    setLines(cur => cur.map(l => {
      if (l.id !== lineId) return l;
      const next = { ...(l as any) };
      const map = { ...(next.lineAdjustments ?? {}) };
      delete map[adjId];
      next.lineAdjustments = map;
      return next;
    }));
  };


  const handleAddAdjustment = (charge: Charge) => {
    setCustomAdjustments(cur => {
      const existing = cur.find(a => a.sourceId === charge.id);
      if (existing) return cur;
      const amount = charge.type === 'percent'
        ? Math.round(billTotals.subtotal * charge.value) / 100
        : charge.value;
      return [...cur, { id: charge.id, note: charge.name, amount, type: charge.type, source: 'charge', sourceId: charge.id }];
    });
  };

  const handleAddCustomAdjustment = (note: string, amount: number) => {
    setCustomAdjustments(cur => [...cur, { id: `custom-${Date.now()}`, note, amount, type: 'fixed', source: 'custom' }]);
  };

  const handleRemoveAdjustment = (id: string) => {
    setCustomAdjustments(cur => cur.filter(a => a.id !== id));
  };

  const billTotals = useMemo(() => {
    return calculateBillTotals(lines, store, billDiscount, customAdjustments);
  }, [lines, store, billDiscount, customAdjustments]);

  const { grandTotal } = billTotals;
  const totalPaid = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments]);
  const remainingBalance = grandTotal - totalPaid;
  const change = Math.max(0, -remainingBalance);

  const handleUpdateLine = (lineId: string, before: Partial<SessionBillLine>, after: Partial<SessionBillLine>) => {
    setLines(currentLines => currentLines.map(l => l.id === lineId ? { ...l, ...after } : l));
    setEditingLine(null);
  };
  
  const handleSave = async () => {
    if (!editReason.trim()) {
      toast({ variant: 'destructive', title: 'Reason Required', description: 'Please provide a reason for this correction.' });
      return;
    }

    if (totalPaid < grandTotal) {
      toast({ variant: 'destructive', title: 'Insufficient Payment', description: 'Total paid cannot be less than the new grand total.' });
      return;
    }

    setIsSubmitting(true);
    
    // Recalculate sales analytics from the edited lines
    const salesAnalytics = lines.reduce(
        (acc, line) => {
            if (line.type !== 'package' && line.type !== 'addon') return acc;
            
            const netQty = Math.max(0, line.qtyOrdered - (line.freeQty || 0) - (line.voidedQty || 0));
            if (netQty <= 0) return acc;

            const grossAmount = netQty * line.unitPrice;
            
            const discountBaseUnit =
              store.taxType === 'VAT_INCLUSIVE' && store.taxRatePct && store.taxRatePct > 0
                ? line.unitPrice / (1 + store.taxRatePct / 100)
                : line.unitPrice;

            const adjs = Object.values((line as any).lineAdjustments ?? {}) as LineAdjustment[];
            const discountAdjs = adjs
              .filter(a => a.kind === "discount")
              .sort((a, b) => (a.createdAtClientMs || 0) - (b.createdAtClientMs || 0));

            const hasAdjDiscount = discountAdjs.length > 0;

            let discountAmount = 0;
            if (hasAdjDiscount) {
              let remaining = netQty;
              for (const a of discountAdjs) {
                const q = Math.min(Number(a.qty || 0), remaining);
                if (q <= 0) continue;

                if (a.type === "percent") {
                  discountAmount += q * discountBaseUnit * ((Number(a.value || 0)) / 100);
                } else {
                  discountAmount += Math.min(discountBaseUnit, Number(a.value || 0)) * q;
                }
                remaining -= q;
                if (remaining <= 0) break;
              }
            } else {
              // legacy fallback
              const discountQty = Math.min(line.discountQty || 0, netQty);
              if (discountQty > 0) {
                if (line.discountType === 'percent') {
                  discountAmount = discountQty * discountBaseUnit * ((line.discountValue || 0) / 100);
                } else {
                  discountAmount = Math.min(discountBaseUnit, line.discountValue ?? 0) * discountQty;
                }
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

    // Reconstruct the receipt data
    const updatedReceiptData: Partial<Receipt> = {
      ...receipt,
      customerName,
      customerTin,
      customerAddress,
      lines,
      billDiscount: billDiscount ?? null,
      customAdjustments: customAdjustments ?? [],
      total: grandTotal,
      totalPaid: totalPaid,
      change: change,
      analytics: {
        v: 2,
        sessionStartedAt: receipt.analytics?.sessionStartedAt,
        sessionStartedAtClientMs: receipt.analytics?.sessionStartedAtClientMs,
        sessionStartedAtHour: receipt.analytics?.sessionStartedAtHour,
        guestCountSnapshot: receipt.analytics?.guestCountSnapshot,
        servedRefillsByName: receipt.analytics?.servedRefillsByName,
        serveCountByType: receipt.analytics?.serveCountByType,
        serveTimeMsTotalByType: receipt.analytics?.serveTimeMsTotalByType,
        subtotal: billTotals.subtotal,
        discountsTotal: billTotals.totalDiscounts,
        chargesTotal: billTotals.chargesTotal,
        taxAmount: billTotals.taxTotal,
        grandTotal: billTotals.grandTotal,
        totalPaid: totalPaid,
        change: change,
        mop: payments.reduce((acc, p) => {
            const key = paymentMethods.find(pm => pm.id === p.methodId)?.name || p.methodId || "unknown";
            acc[key] = (acc[key] || 0) + p.amount;
            return acc;
        }, {} as Record<string, number>),
        salesByItem: salesAnalytics.salesByItem,
        salesByCategory: salesAnalytics.salesByCategory,
      },
    };

    try {
        await onSave(updatedReceiptData, editReason);
        
        const oldDiscountTotal = receipt.analytics?.discountsTotal ?? 0;
        const newDiscountTotal = billTotals.totalDiscounts;
        const discountDelta = newDiscountTotal - oldDiscountTotal;
        
        if (Math.abs(discountDelta) > 0.01 && appUser) { // Use a small tolerance
          await writeActivityLog({
            action: "DISCOUNT_EDITED",
            storeId: store.id,
            sessionId: receipt.sessionId,
            user: appUser,
            note: editReason,
            meta: {
                receiptNumber: receipt.receiptNumber,
                scope: 'bill',
                oldDiscountTotal: oldDiscountTotal,
                newDiscountTotal: newDiscountTotal,
                delta: discountDelta,
                discountName: "Discount Correction"
            },
          });
        }
    } catch (error) {
        // onSave will show its own toast
    } finally {
        setIsSubmitting(false);
    }
  };

  const itemDiscounts = useMemo(() => discounts.filter(d => (Array.isArray(d.scope) ? d.scope.includes("item") : d.scope === "item")), [discounts]);

  // Mock session object for components that expect it
  const mockSession = {
    id: receipt.sessionId,
    storeId: receipt.storeId,
  } as PendingSession;

  return (
    <>
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto p-4">
        {/* Left column for billing details */}
        <div className="flex flex-col gap-4">
          <BillableItems
            lines={lines}
            storeId={store.id}
            session={mockSession}
            discounts={itemDiscounts}
            onUpdateLine={(line) => setEditingLine(line)}
            onAddLine={(newLine) => {
                setLines((currentLines) => {
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
          <PaymentSection
            paymentMethods={paymentMethods}
            payments={payments}
            setPayments={setPayments}
            totalPaid={totalPaid}
            remainingBalance={remainingBalance}
            change={change}
          />
        </div>

        {/* Right column for totals and customer info */}
        <div className="flex flex-col gap-4">
          <BillTotals
            lines={lines}
            store={store}
            billDiscount={billDiscount}
            customAdjustments={customAdjustments}
            totalPaid={totalPaid}
            onRemoveLineAdjustment={handleRemoveLineAdjustment}
          />
          <BillAdjustments
            appUser={appUser}
            adjustments={customAdjustments}
            billDiscount={billDiscount}
            charges={charges}
            discounts={discounts.filter(d => (Array.isArray(d.scope) ? d.scope.includes("bill") : d.scope === "bill"))}
            onAddAdjustment={handleAddAdjustment}
            onAddCustomAdjustment={handleAddCustomAdjustment}
            onRemoveAdjustment={handleRemoveAdjustment}
            onSetBillDiscount={setBillDiscount}
          />
          <div className="p-4 border rounded-md">
            <h3 className="font-semibold mb-2">Customer Details (for BIR)</h3>
            <div className="space-y-2">
              <div>
                <Label htmlFor="customerName">Name</Label>
                <Input id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="customerTin">TIN</Label>
                <Input id="customerTin" value={customerTin} onChange={(e) => setCustomerTin(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="customerAddress">Address</Label>
                <Input id="customerAddress" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="p-4 border-t">
        <Label htmlFor="editReason">Reason for Correction (Required)</Label>
        <Textarea
          id="editReason"
          value={editReason}
          onChange={(e) => setEditReason(e.target.value)}
          placeholder="e.g., Corrected customer TIN for official receipt."
          className="mt-2"
        />
      </div>

      <DialogFooter className="p-4 pt-0">
        <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
        <Button onClick={handleSave} disabled={isSubmitting || !editReason.trim()}>
          {isSubmitting ? <Loader2 className="animate-spin mr-2"/> : null}
          Save Correction
        </Button>
      </DialogFooter>

      {editingLine && (
        <EditBillableItemDialog
          isOpen={!!editingLine}
          onClose={() => setEditingLine(null)}
          line={editingLine}
          discounts={itemDiscounts}
          onSave={handleUpdateLine}
          onAddLineAdjustment={handleAddLineAdjustment}
        />
      )}
    </>
  );
}

export function EditReceiptDialog(props: EditReceiptDialogProps) {
  const isMobile = useIsMobile();
  
  if (isMobile) {
      return (
          <Drawer open={props.isOpen} onOpenChange={props.onClose}>
              <DrawerContent className="h-[90vh]">
                  <DrawerHeader>
                      <DrawerTitle>Edit Receipt: {props.receipt.receiptNumber}</DrawerTitle>
                      <DrawerDescription>Make corrections to this finalized receipt.</DrawerDescription>
                  </DrawerHeader>
                  <EditReceiptContent {...props} />
              </DrawerContent>
          </Drawer>
      )
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onClose}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>Edit Receipt: {props.receipt.receiptNumber}</DialogTitle>
          <DialogDescription>Make corrections to this finalized receipt. All changes are audited.</DialogDescription>
        </DialogHeader>
        <EditReceiptContent {...props} />
      </DialogContent>
    </Dialog>
  );
}