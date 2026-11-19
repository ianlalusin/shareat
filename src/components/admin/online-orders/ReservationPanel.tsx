"use client";

import { useState } from "react";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DEPOSIT_METHODS,
  DEPOSIT_RATIO,
  balanceOf,
  paidAmount,
  reservationBadge,
  type ReservationPayment,
} from "@/lib/online-orders/reservation";
import { uploadReservationProof } from "@/lib/online-orders/uploadReservationProof";

export type ReservationOrder = {
  id: string;
  status: string;
  grandTotal?: number;
  deliveryFee?: number;
  deliveryFeeTbd?: boolean;
  fulfillment?: { type?: "pickup" | "delivery" };
  payments?: ReservationPayment[];
  scheduledAtMs?: number;
  releaseAtMs?: number;
  receiptNumber?: string;
};

const peso = (n: number) => `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE_VARIANT = { red: "destructive", amber: "secondary", green: "default", gray: "outline" } as const;

export function reservationWhen(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Payment + delivery-fee controls for a website set reservation. All writes go through `call` (the server op). */
export function ReservationPanel({
  order,
  storeId,
  call,
  busy,
}: {
  order: ReservationOrder;
  storeId: string;
  call: (payload: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
}) {
  const payments = order.payments || [];
  const total = Number(order.grandTotal || 0);
  const completed = order.status === "completed";
  const recorded = paidAmount(payments);
  // Completed: the balance was collected at hand-over, so the whole total is received.
  const paid = completed ? total : recorded;
  const balance = completed ? 0 : balanceOf(total, payments);
  const handOver = completed ? Math.max(0, Math.round((total - recorded) * 100) / 100) : 0;
  const badge = reservationBadge({ ...order, grandTotal: total }, Date.now());
  const closed = ["completed", "cancelled", "rejected"].includes(order.status) || !!order.receiptNumber;
  const isDelivery = order.fulfillment?.type === "delivery";
  const toReach50 = Math.max(0, Math.round((total * DEPOSIT_RATIO - paid) * 100) / 100);

  const [fee, setFee] = useState("");
  const validFee = fee.trim() !== "" && Number.isFinite(Number(fee));
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>(DEPOSIT_METHODS[0]);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0); // remounts the file input so the old file name disappears
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeReason, setRemoveReason] = useState("");
  const [proofView, setProofView] = useState<string | null>(null); // screenshot shown in an in-app window

  const submitPayment = async () => {
    setUploadError("");
    let proofUrl: string | undefined;
    if (file) {
      try {
        setUploading(true);
        proofUrl = await uploadReservationProof(file, storeId, order.id);
      } catch {
        setUploadError("Screenshot upload failed. Try again, or use a reference number.");
        return;
      } finally {
        setUploading(false);
      }
    }
    const ok = await call({ op: "record-payment", orderId: order.id, amount: Number(amount), methodLabel: method, reference: reference.trim(), proofUrl });
    if (ok) {
      setAmount("");
      setReference("");
      setFile(null);
      setFileKey((k) => k + 1);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Reservation · {reservationWhen(order.scheduledAtMs)}</Badge>
        <Badge variant={TONE_VARIANT[badge.tone]}>{badge.label}{badge.label.endsWith(", due") ? ` ${reservationWhen(order.releaseAtMs)}` : ""}</Badge>
      </div>
      {order.status === "pending" && (
        <p className="text-xs text-muted-foreground">
          Call the customer to arrange payment. Recording at least {Math.round(DEPOSIT_RATIO * 100)}% confirms the order and it goes to the kitchen 2 hours before. Unpaid orders are not sent to the kitchen.
        </p>
      )}

      {isDelivery && order.deliveryFeeTbd && payments.length === 0 && !closed && (
        <div className="space-y-1 border-t pt-2">
          <Label className="text-xs">Delivery fee: set it from the distance (usually ₱100 to ₱200) before taking payment</Label>
          <div className="flex gap-2">
            <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="₱" className="max-w-[8rem]" />
            <Button size="sm" disabled={busy || !validFee} onClick={async () => { if (await call({ op: "set-delivery-fee", orderId: order.id, fee: Number(fee) })) setFee(""); }}>Set fee</Button>
          </div>
        </div>
      )}
      {isDelivery && !order.deliveryFeeTbd && (order.deliveryFee || 0) === 0 && payments.length === 0 && !closed && (
        <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
          Free delivery applied. If the address is outside the free area, set a fee:
          <div className="mt-1 flex gap-2">
            <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="₱" className="max-w-[8rem]" />
            <Button size="sm" variant="outline" disabled={busy || !validFee} onClick={async () => { if (await call({ op: "set-delivery-fee", orderId: order.id, fee: Number(fee) })) setFee(""); }}>Set fee</Button>
          </div>
        </div>
      )}

      <div className="space-y-1 border-t pt-2 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span>{peso(total)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Received</span><span>{peso(paid)}</span></div>
        <div className="flex justify-between font-medium"><span>{completed ? "Balance" : "Balance (collect at hand-over)"}</span><span>{peso(balance)}</span></div>
        {handOver > 0 && <div className="flex justify-between text-xs text-muted-foreground"><span>Collected at hand-over</span><span>{peso(handOver)}</span></div>}
      </div>

      {payments.length > 0 && (
        <ul className="space-y-1 border-t pt-2 text-xs">
          {payments.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {peso(p.amount)} · {p.methodLabel}{p.reference ? ` · ref ${p.reference}` : ""} · {p.byName}
              </span>
              {p.proofUrl && (
                <button type="button" onClick={() => setProofView(p.proofUrl)} className="inline-flex items-center gap-1 text-primary underline">
                  Screenshot <ImageIcon className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!closed && balance > 0 && !(isDelivery && order.deliveryFeeTbd) && (
        <div className="space-y-2 border-t pt-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Amount received {toReach50 > 0 ? `(50% = ${peso(toReach50)} more)` : ""}</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(toReach50 || balance)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEPOSIT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reference number <span className="font-normal text-muted-foreground">(or attach a screenshot)</span></Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value.slice(0, 80))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Screenshot</Label>
            <Input key={fileKey} type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
          </div>
          <div className="flex justify-end">
            <Button size="sm" disabled={busy || uploading || !amount || (!reference.trim() && !file)} onClick={submitPayment}>
              {busy || uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record payment"}
            </Button>
          </div>
        </div>
      )}

      {!closed && payments.length > 0 && (
        removing ? (
          <div className="space-y-2 border-t pt-2">
            <Textarea value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} rows={2} placeholder="Why remove the last payment? (required)" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setRemoving(false); setRemoveReason(""); }}>Back</Button>
              <Button variant="destructive" size="sm" disabled={busy || !removeReason.trim()} onClick={async () => { if (await call({ op: "remove-last-payment", orderId: order.id, reason: removeReason.trim() })) { setRemoving(false); setRemoveReason(""); } }}>Remove</Button>
            </div>
          </div>
        ) : (
          <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setRemoving(true)}>Remove last payment</button>
        )
      )}

      <Dialog open={!!proofView} onOpenChange={(open) => !open && setProofView(null)}>
        <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payment screenshot</DialogTitle>
          </DialogHeader>
          {proofView && <img src={proofView} alt="Payment screenshot" className="max-h-[70dvh] w-full rounded-md border object-contain" />}
        </DialogContent>
      </Dialog>

      {paid > 0 && !closed && (
        <p className="border-t pt-2 text-xs text-amber-700">If you cancel this order, {peso(paid)} was already received. Refund it to the customer yourself; the POS does not do it.</p>
      )}
    </div>
  );
}
