"use client";

import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import type { Receipt, SessionBillLine, ModeOfPayment } from "@/lib/types";
import type { AppUser } from "@/context/auth-context";
import { createRefundReceipt } from "@/components/cashier/firestore";
import { reverseReceiptLoyalty } from "@/lib/loyalty/reverse-receipt-client";
import { previewLineRefund, previewRefundTotal, remainingRefundableQty } from "@/lib/analytics/refund-quote";
import { v4 as uuidv4 } from "uuid";

interface RefundReceiptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: Receipt;
  paymentMethods: ModeOfPayment[];
  actor: AppUser;
  onSuccess: (refundReceiptId: string) => void;
}

type RefundQty = Record<string, number>; // lineId -> qty to refund

function RefundContent({
  receipt,
  actor,
  onClose,
  onSuccess,
}: RefundReceiptDialogProps) {
  const { toast } = useToast();
  const [refundQtys, setRefundQtys] = useState<RefundQty>({});
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Idempotency key for this dialog: a retry/double-submit reuses it, so the
  // save can never create a second refund for the same request.
  const [requestId] = useState(() => uuidv4());

  const getMaxQty = (l: SessionBillLine) => remainingRefundableQty(receipt as any, l);

  const billableLines = useMemo(() =>
    (receipt.lines || []).filter(l => remainingRefundableQty(receipt as any, l) > 0),
    [receipt]
  );

  const getRefundQty = (id: string) => refundQtys[id] ?? 0;

  const setQty = (id: string, val: number, max: number) => {
    const clamped = Math.max(0, Math.min(max, isNaN(val) ? 0 : val));
    setRefundQtys(cur => ({ ...cur, [id]: clamped }));
  };

  // Same valuation the save uses (quoteRefund): what was actually paid, with
  // discounts/modifiers/charges shared out, capped at what is left to refund.
  const refundTotal = useMemo(
    () => previewRefundTotal(receipt as any, refundQtys),
    [receipt, refundQtys]
  );

  const hasAnyQty = Object.values(refundQtys).some(q => q > 0) && refundTotal > 0;

  const handleSelectAll = () => {
    const all: RefundQty = {};
    billableLines.forEach(l => { all[l.id] = getMaxQty(l); });
    setRefundQtys(all);
  };

  const handleClearAll = () => setRefundQtys({});

  const handleSubmit = async () => {
    if (!hasAnyQty) {
      toast({ variant: "destructive", title: "No items selected", description: "Select at least one item to refund." });
      return;
    }
    if (!reason.trim()) {
      toast({ variant: "destructive", title: "Reason required", description: "Please provide a reason for the refund." });
      return;
    }

    const qtys: Record<string, number> = {};
    billableLines.forEach(l => { const q = getRefundQty(l.id); if (q > 0) qtys[l.id] = q; });

    setIsSubmitting(true);
    try {
      // Lines, amount and tender split are recomputed inside the save's
      // transaction from the live receipt (same quoteRefund math as above).
      const refundId = await createRefundReceipt(
        receipt.storeId,
        receipt,
        qtys,
        actor,
        reason,
        requestId,
      );
      toast({ title: "Refund created", description: `Refund receipt RF-${receipt.receiptNumber} has been saved.` });
      // Take back the share of loyalty points this refund covers (and return
      // vouchers once fully refunded). Server-side, idempotent per refund
      // receipt; fire-and-forget with a toast on failure.
      reverseReceiptLoyalty(
        { storeId: receipt.storeId, receiptId: receipt.receiptId ?? receipt.id, reason: "refund", refundReceiptId: refundId },
        toast,
      );
      onSuccess(refundId);
      onClose();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Refund failed", description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {billableLines.length === 0 && (
          <div className="text-center text-muted-foreground py-10">
            All items on this receipt have already been fully refunded.
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Select quantities to refund.</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSelectAll}>Select All</Button>
            <Button variant="ghost" size="sm" onClick={handleClearAll}>Clear</Button>
          </div>
        </div>

        <div className="border rounded-md divide-y">
          {billableLines.map(line => {
            const max = getMaxQty(line);
            const qty = getRefundQty(line.id);
            return (
              <div key={line.id} className="flex items-center justify-between px-4 py-3 gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{line.itemName}</p>
                  <p className="text-xs text-muted-foreground">₱{(line.unitPrice + Number((line as any).modifiersTotal || 0)).toFixed(2)} × {max} available</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setQty(line.id, qty - 1, max)} disabled={qty <= 0}>−</Button>
                  <Input
                    type="number"
                    className="w-14 h-7 text-center p-1"
                    value={qty}
                    min={0}
                    max={max}
                    onChange={e => setQty(line.id, parseInt(e.target.value), max)}
                  />
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setQty(line.id, qty + 1, max)} disabled={qty >= max}>+</Button>
                  <span className="text-sm w-20 text-right">₱{previewLineRefund(receipt as any, line.id, qty).toFixed(2)}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <p className="font-semibold text-lg">Refund Total: ₱{refundTotal.toFixed(2)}</p>
        </div>

        <div>
          <Label htmlFor="refundReason">Reason for Refund (Required)</Label>
          <Textarea
            id="refundReason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g., Customer returned items, overcharge correction..."
            className="mt-2"
          />
        </div>
      </div>

      <DialogFooter className="p-4 border-t">
        <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={isSubmitting || !hasAnyQty || !reason.trim()} variant="destructive">
          {isSubmitting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
          Issue Refund
        </Button>
      </DialogFooter>
    </>
  );
}

export function RefundReceiptDialog(props: RefundReceiptDialogProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={props.isOpen} onOpenChange={props.onClose}>
        <DrawerContent className="h-[90dvh] flex flex-col">
          <DrawerHeader>
            <DrawerTitle>Refund: {props.receipt.receiptNumber}</DrawerTitle>
            <DrawerDescription>Select items and quantities to refund.</DrawerDescription>
          </DrawerHeader>
          <RefundContent {...props} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onClose}>
      <DialogContent className="max-w-2xl h-[85dvh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>Refund: {props.receipt.receiptNumber}</DialogTitle>
          <DialogDescription>Select items and quantities to refund. A new RF- receipt will be created.</DialogDescription>
        </DialogHeader>
        <RefundContent {...props} />
      </DialogContent>
    </Dialog>
  );
}
