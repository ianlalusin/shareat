"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Receipt } from "@/lib/types";
import { roundMoney } from "@/lib/money";

export type VoidDisposition = "refunded" | "retained" | "partial";

export type VoidConfirmResult = {
  reason: string;
  voidCashPaid: number;
  voidCashRefunded: number;
  voidCashRetained: number;
  voidCashDisposition: VoidDisposition;
};

type Props = {
  open: boolean;
  receipt: Receipt | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (result: VoidConfirmResult) => void | Promise<void>;
};

/** Sum the cash component of a receipt's payments (mop keys containing "cash"). */
function cashPaidOf(receipt: Receipt | null): number {
  const mop = (receipt?.analytics?.mop ?? {}) as Record<string, number>;
  let cash = 0;
  for (const [k, v] of Object.entries(mop)) {
    if (k.toLowerCase().includes("cash")) cash += Number(v || 0);
  }
  return roundMoney(cash);
}

export default function VoidReceiptModal({ open, receipt, onOpenChange, onConfirm }: Props) {
  const cashPaid = useMemo(() => cashPaidOf(receipt), [receipt]);
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState<VoidDisposition>("refunded");
  const [partialRefund, setPartialRefund] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setDisposition("refunded");
      setPartialRefund("");
      setSubmitting(false);
    }
  }, [open]);

  const trimmed = reason.trim();
  const partialNum = roundMoney(Number(partialRefund || 0));
  const partialValid = disposition !== "partial" || (partialNum > 0 && partialNum < cashPaid);
  const canConfirm = trimmed.length > 0 && partialValid;

  const refunded =
    disposition === "refunded" ? cashPaid : disposition === "retained" ? 0 : partialNum;
  const retained = roundMoney(cashPaid - refunded);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm({
        reason: trimmed,
        voidCashPaid: cashPaid,
        voidCashRefunded: roundMoney(refunded),
        voidCashRetained: retained,
        voidCashDisposition: disposition,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const Opt = ({ value, label, hint }: { value: VoidDisposition; label: string; hint: string }) => (
    <button
      type="button"
      onClick={() => setDisposition(value)}
      className={`w-full rounded-md border p-3 text-left text-sm transition ${
        disposition === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted"
      }`}
    >
      <div className="font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => (!submitting ? onOpenChange(o) : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void Receipt</DialogTitle>
          <DialogDescription>
            Voiding reverses the sale and keeps the receipt for audit. Tell us what happened to the cash so remittance stays accurate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for void..." autoFocus />
            {!trimmed && <div className="text-xs text-muted-foreground">Reason is required.</div>}
          </div>

          {cashPaid > 0 ? (
            <div className="space-y-2">
              <Label>Cash paid: ₱{cashPaid.toFixed(2)} — what happened to it?</Label>
              <div className="grid gap-2">
                <Opt value="refunded" label="Refunded in full" hint="Cash returned to the customer; it leaves the drawer." />
                <Opt value="retained" label="No refund (cash retained)" hint="Cash stays in the drawer; it will be remitted as void-cash." />
                <Opt value="partial" label="Partial refund" hint="Some cash returned; the rest is retained." />
              </div>
              {disposition === "partial" && (
                <div className="space-y-1">
                  <Label className="text-xs">Amount refunded</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={partialRefund}
                    onChange={(e) => setPartialRefund(e.target.value)}
                    placeholder={`0.00 – ${cashPaid.toFixed(2)}`}
                  />
                  {!partialValid && (
                    <div className="text-xs text-destructive">Enter an amount between 0 and {cashPaid.toFixed(2)}.</div>
                  )}
                </div>
              )}
              <div className="rounded-md bg-muted p-2 text-xs">
                Refunded <span className="font-mono">₱{roundMoney(refunded).toFixed(2)}</span> · Retained{" "}
                <span className="font-mono font-semibold">₱{retained.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              No cash payment on this receipt — nothing to refund.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" type="button" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={!canConfirm || submitting} onClick={handleConfirm}>
            Void Receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
