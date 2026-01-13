
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
import type { Receipt, Discount, Charge, Payment, SessionBillLine, ModeOfPayment, Store, Adjustment, PendingSession } from "@/lib/types";
import { calculateBillTotals } from "@/lib/tax";
import { Loader2 } from "lucide-react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

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
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editReason, setEditReason] = useState("");

  // Editable state
  const [customerName, setCustomerName] = useState(receipt.customerName || "");
  const [customerTin, setCustomerTin] = useState(receipt.customerTin || "");
  const [customerAddress, setCustomerAddress] = useState(receipt.customerAddress || "");
  const [lines, setLines] = useState<SessionBillLine[]>(() => JSON.parse(JSON.stringify(receipt.lines || [])));
  const [billDiscount, setBillDiscount] = useState<Discount | null>(null); // TODO: implement bill discount edit
  const [customAdjustments, setCustomAdjustments] = useState<Adjustment[]>([]); // TODO: implement custom adjustments edit
  const [payments, setPayments] = useState<Payment[]>(() => {
    return Object.entries(receipt.analytics?.mop || {}).map(([key, value], i) => ({
      id: `payment-${i}`,
      methodId: paymentMethods.find(pm => pm.name === key)?.id || 'unknown',
      amount: value as number,
    }));
  });

  const [editingLine, setEditingLine] = useState<SessionBillLine | null>(null);
  
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
    
    // Reconstruct the receipt data
    const updatedReceiptData: Partial<Receipt> = {
      ...receipt,
      customerName,
      customerTin,
      customerAddress,
      lines,
      total: grandTotal,
      totalPaid: totalPaid,
      change: change,
      analytics: {
        ...receipt.analytics,
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
      },
    };

    await onSave(updatedReceiptData, editReason);
    setIsSubmitting(false);
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
