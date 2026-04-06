"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, X, Loader2, CheckCircle2, Delete } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useIsMobile } from "@/hooks/use-mobile";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { completePaymentFromUnits } from "@/components/cashier/firestore";
import { addToQueue } from "@/lib/offline/payment-queue";
import type { Payment, ModeOfPayment, SessionBillLine, Store, Discount, Adjustment, PendingSession } from "@/lib/types";
import type { AppUser } from "@/context/auth-context";
import type { User } from "firebase/auth";

// --- Numpad ---
function Numpad({ onKey, onBackspace, onClear, onConfirm, confirmDisabled, confirmLabel, isProcessing }: {
  onKey: (key: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onConfirm: () => void;
  confirmDisabled: boolean;
  confirmLabel: React.ReactNode;
  isProcessing: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

  return (
    <div className="grid grid-cols-3 gap-1.5 select-none">
      {keys.map((key) => (
        <Button
          key={key}
          type="button"
          variant="outline"
          className="h-12 text-lg font-medium tabular-nums"
          disabled={isProcessing}
          onClick={() => {
            if (key === "⌫") onBackspace();
            else onKey(key);
          }}
        >
          {key === "⌫" ? <Delete className="h-5 w-5" /> : key}
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        className="h-12 text-sm text-muted-foreground"
        disabled={isProcessing}
        onClick={onClear}
      >
        Clear
      </Button>
      <Button
        type="button"
        className="h-12 col-span-2 text-base font-semibold"
        disabled={confirmDisabled || isProcessing}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}

// --- Validation ---
function validatePayments(payments: Payment[], grandTotalCents: number, paymentMethods: ModeOfPayment[]): string | null {
  if (!payments || payments.length === 0) return "Add at least one payment method.";
  for (const p of payments) {
    if (!p.methodId) return "Select a payment method.";
    const amountCents = Math.round(Number(p.amount || 0) * 100);
    if (amountCents <= 0) return "Payment amounts must be greater than zero.";
    const methodDetails = paymentMethods.find(pm => pm.id === p.methodId);
    if (!methodDetails) return "Payment method not found. It may have been deleted.";
    if (methodDetails.hasRef && (!p.reference || String(p.reference).trim().length === 0)) {
      return `Reference is required for ${methodDetails.name}.`;
    }
  }
  const totalPaidCents = payments.reduce((s, p) => s + Math.round(Number(p.amount || 0) * 100), 0);
  if (totalPaidCents < grandTotalCents - 1) {
    return `Payment is not enough. Balance: ₱${((grandTotalCents - totalPaidCents) / 100).toFixed(2)}`;
  }
  return null;
}

// --- Success Overlay ---
function SuccessOverlay({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2500);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/95 rounded-lg animate-in fade-in-0 zoom-in-95 duration-300">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping" />
        <CheckCircle2 className="h-16 w-16 text-green-500 relative" />
      </div>
      <p className="mt-4 text-lg font-semibold text-green-600">Payment Successful</p>
      <p className="text-sm text-muted-foreground mt-1">Generating receipt...</p>
      <Button variant="ghost" size="sm" className="mt-4 text-muted-foreground" onClick={onDone}>
        Close
      </Button>
    </div>
  );
}

// --- Main Modal ---
interface PaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grandTotal: number;
  sessionId: string;
  storeId: string;
  session: PendingSession;
  activeStore: Store;
  appUser: AppUser;
  firebaseUser: User | null;
  paymentMethods: ModeOfPayment[];
  billLines: SessionBillLine[];
  billDiscount: Discount | null;
  customAdjustments: Adjustment[];
}

export function PaymentModal({
  open,
  onOpenChange,
  grandTotal,
  sessionId,
  storeId,
  session,
  activeStore,
  appUser,
  firebaseUser,
  paymentMethods,
  billLines,
  billDiscount,
  customAdjustments,
}: PaymentModalProps) {
  const router = useRouter();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const isMobile = useIsMobile();

  const [payments, setPayments] = useState<Payment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
  // Track which payment row the numpad controls
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  // Raw string buffer for the numpad-driven amount
  const [numpadBuffer, setNumpadBuffer] = useState<string>("");

  // Initialize with one cash payment when modal opens
  useEffect(() => {
    if (open) {
      const cashMethod = paymentMethods.find(pm => pm.type === "cash");
      const defaultMethodId = cashMethod?.id || (paymentMethods.length > 0 ? paymentMethods[0].id : "");
      const initialId = `pay-${Date.now()}`;
      setPayments([{
        id: initialId,
        methodId: defaultMethodId,
        amount: Math.round(grandTotal * 100) / 100,
        reference: "",
      }]);
      setIsProcessing(false);
      setShowSuccess(false);
      setPendingRedirect(null);
      setActivePaymentId(initialId);
      setNumpadBuffer(grandTotal.toFixed(2).replace(/\.?0+$/, ""));
    }
  }, [open, grandTotal, paymentMethods]);

  const grandTotalCents = Math.round(grandTotal * 100);
  const totalPaid = useMemo(() => payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0), [payments]);
  const totalPaidCents = Math.round(totalPaid * 100);
  const remainingCents = grandTotalCents - totalPaidCents;
  const remainingBalance = Math.max(0, remainingCents) / 100;
  const change = Math.max(0, -remainingCents) / 100;
  const canComplete = grandTotalCents > 0 && remainingCents <= 1;

  const addPayment = () => {
    const cashMethod = paymentMethods.find(pm => pm.type === "cash");
    const defaultMethodId = cashMethod?.id || (paymentMethods.length > 0 ? paymentMethods[0].id : "");
    const newAmount = remainingBalance > 0 ? Math.round(remainingBalance * 100) / 100 : 0;
    const newId = `pay-${Date.now()}`;
    setPayments(prev => [...prev, { id: newId, methodId: defaultMethodId, amount: newAmount, reference: "" }]);
    setActivePaymentId(newId);
    setNumpadBuffer(newAmount > 0 ? newAmount.toString() : "");
  };

  const removePayment = (id: string) => {
    setPayments(prev => {
      const next = prev.filter(p => p.id !== id);
      if (activePaymentId === id && next.length > 0) {
        setActivePaymentId(next[0].id);
        setNumpadBuffer(next[0].amount.toString());
      }
      return next;
    });
  };

  const updatePayment = (id: string, updates: Partial<Payment>) => {
    setPayments(prev => prev.map(p => (p.id === id ? { ...p, ...updates } : p)));
  };

  // Focus a payment row for numpad input — dismiss keyboard
  const focusPayment = (id: string) => {
    // Blur any focused input to dismiss the virtual keyboard
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setActivePaymentId(id);
    const p = payments.find(p => p.id === id);
    if (p) setNumpadBuffer(p.amount > 0 ? p.amount.toString() : "");
  };

  // Numpad handlers
  const handleNumpadKey = (key: string) => {
    if (!activePaymentId) return;
    setNumpadBuffer(prev => {
      // Prevent multiple dots
      if (key === "." && prev.includes(".")) return prev;
      // Limit to 2 decimal places
      if (prev.includes(".") && prev.split(".")[1].length >= 2 && key !== ".") return prev;
      const next = prev + key;
      const num = parseFloat(next);
      if (!isNaN(num) || next === "" || next === ".") {
        updatePayment(activePaymentId, { amount: isNaN(num) ? 0 : num });
      }
      return next;
    });
  };

  const handleNumpadBackspace = () => {
    if (!activePaymentId) return;
    setNumpadBuffer(prev => {
      const next = prev.slice(0, -1);
      const num = parseFloat(next);
      updatePayment(activePaymentId, { amount: isNaN(num) || next === "" ? 0 : num });
      return next;
    });
  };

  const handleNumpadClear = () => {
    if (!activePaymentId) return;
    setNumpadBuffer("");
    updatePayment(activePaymentId, { amount: 0 });
  };

  const handleSuccessDone = useCallback(() => {
    if (pendingRedirect) {
      router.push(pendingRedirect);
    }
  }, [pendingRedirect, router]);

  const handleComplete = async () => {
    if (isProcessing) return;

    const err = validatePayments(payments, grandTotalCents, paymentMethods);
    if (err) {
      toast({ variant: "destructive", title: "Cannot Complete", description: err });
      return;
    }
    if (!canComplete) {
      toast({ variant: "destructive", title: "Cannot Complete", description: "Please ensure balance is paid." });
      return;
    }

    setIsProcessing(true);
    const normalizedPayments = payments.map(p => ({ ...p, amount: Math.round(Number(p.amount || 0) * 100) / 100 }));

    // --- OFFLINE ---
    if (!isOnline) {
      try {
        addToQueue({
          storeId,
          sessionId,
          payload: { payments: normalizedPayments, billLines, billDiscount, customAdjustments, totalAmount: grandTotal },
        });
        setShowSuccess(true);
        setPendingRedirect("/cashier");
      } catch (e: any) {
        toast({ variant: "destructive", title: "Queue failed", description: e?.message ?? "Could not queue payment." });
        setIsProcessing(false);
      }
      return;
    }

    // --- ONLINE ---
    try {
      const activeProjectionSnap = await getDoc(doc(db, "stores", storeId, "activeSessions", sessionId));
      const currentPin = activeProjectionSnap.exists() ? String(activeProjectionSnap.data()?.customerPin || "") : "";

      const receiptId = await completePaymentFromUnits(
        storeId, sessionId, appUser, normalizedPayments,
        billLines, activeStore, paymentMethods, billDiscount, customAdjustments,
      );

      const settingsSnap = await getDoc(doc(db, "stores", storeId, "receiptSettings", "main"));
      const autoPrint = settingsSnap.exists() && !!settingsSnap.data()?.autoPrintAfterPayment;
      setShowSuccess(true);
      setPendingRedirect(`/receipt/${receiptId}${autoPrint ? "?autoprint=1" : ""}`);

      // PIN cleanup (fire-and-forget)
      if (firebaseUser && currentPin) {
        const token = await firebaseUser.getIdToken();
        fetch("/api/pins/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ storeId, sessionId, pin: currentPin, reason: "payment_closed" }),
        }).catch(() => {
          fetch("/api/pins/disable", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ storeId, sessionId }),
          }).catch(() => console.error("[PIN] Fallback disable also failed for session", sessionId));
        });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Payment failed", description: e?.message ?? "Something went wrong." });
      setIsProcessing(false);
    }
  };

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const confirmLabel = isProcessing ? (
    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {isOnline ? "Processing..." : "Queuing..."}</>
  ) : isOnline ? "Confirm Payment" : "⚡ Queue (Offline)";

  // --- Payment form (shared between layouts) ---
  const paymentForm = (
    <div className="flex flex-col min-h-0 flex-1">
      <DialogHeader className="pb-2">
        <DialogTitle>Complete Payment</DialogTitle>
        <DialogDescription>
          Total due: <span className="font-semibold text-foreground text-base">₱{fmt(grandTotal)}</span>
        </DialogDescription>
      </DialogHeader>

      {/* Scrollable payment rows */}
      <div className="flex-1 overflow-y-auto space-y-2 py-2 min-h-0">
        {payments.map((payment) => {
          const method = paymentMethods.find(pm => pm.id === payment.methodId);
          const isActive = activePaymentId === payment.id;
          return (
            <div
              key={payment.id}
              className={`rounded-lg border p-2.5 cursor-pointer transition-colors ${isActive ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border"} ${method?.hasRef ? "space-y-2" : ""}`}
              onClick={() => focusPayment(payment.id)}
            >
              <div className="flex items-center gap-1.5">
                <Select value={payment.methodId} onValueChange={(val) => updatePayment(payment.id, { methodId: val })} disabled={isProcessing}>
                  <SelectTrigger className="h-9 min-w-0 flex-1 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {paymentMethods.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/* Amount display — driven by numpad, no virtual keyboard */}
                <div
                  className={`flex items-center h-9 rounded-md border px-2.5 text-sm tabular-nums cursor-pointer select-none w-[120px] shrink-0 ${isActive ? "border-primary bg-background" : "bg-muted/50"}`}
                  onFocus={(e) => e.preventDefault()}
                >
                  <span className="text-muted-foreground text-xs mr-0.5">₱</span>
                  <input
                    readOnly
                    inputMode="none"
                    tabIndex={-1}
                    value={isActive ? (numpadBuffer || "0") : payment.amount.toFixed(2)}
                    className="flex-1 bg-transparent outline-none caret-transparent pointer-events-none text-sm tabular-nums w-full"
                    onFocus={(e) => e.target.blur()}
                  />
                </div>
                {payments.length > 1 && (
                  <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-muted-foreground" onClick={(e) => { e.stopPropagation(); removePayment(payment.id); }} disabled={isProcessing}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {method?.hasRef && (
                <Input
                  placeholder="Reference #"
                  value={payment.reference || ""}
                  onChange={(e) => updatePayment(payment.id, { reference: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  disabled={isProcessing}
                  className="h-9 text-sm"
                />
              )}
            </div>
          );
        })}

        {remainingBalance > 0.01 && !isProcessing && (
          <Button variant="outline" size="sm" onClick={addPayment} className="w-full">
            <PlusCircle className="mr-2 h-4 w-4" /> Split Payment
          </Button>
        )}
      </div>

      {/* Totals */}
      <div className="border-t pt-2 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Paid</span>
          <span className="font-medium">₱{fmt(totalPaid)}</span>
        </div>
        <div className={`flex justify-between font-medium ${remainingBalance > 0.01 ? "text-destructive" : "text-green-600"}`}>
          <span>{remainingBalance > 0.01 ? "Balance" : "Change"}</span>
          <span>₱{fmt(remainingBalance > 0.01 ? remainingBalance : change)}</span>
        </div>
      </div>
    </div>
  );

  const numpad = (
    <Numpad
      onKey={handleNumpadKey}
      onBackspace={handleNumpadBackspace}
      onClear={handleNumpadClear}
      onConfirm={handleComplete}
      confirmDisabled={!canComplete}
      confirmLabel={confirmLabel}
      isProcessing={isProcessing}
    />
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isProcessing && !showSuccess) onOpenChange(v); }}>
      <DialogContent
        className={
          isMobile
            ? "sm:max-w-md max-h-[95dvh] flex flex-col overflow-hidden p-4"
            : "max-w-2xl max-h-[90dvh] flex flex-row overflow-hidden p-0 gap-0"
        }
      >
        {isMobile ? (
          /* ---- MOBILE: stacked layout ---- */
          <>
            {paymentForm}
            <div className="border-t pt-3 pb-1">
              {numpad}
            </div>
          </>
        ) : (
          /* ---- WIDESCREEN: side by side ---- */
          <>
            <div className="flex-1 flex flex-col p-6 overflow-hidden border-r">
              {paymentForm}
            </div>
            <div className="w-[280px] shrink-0 p-4 flex flex-col justify-end">
              <div className="mb-3 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Amount</p>
                <p className="text-3xl font-bold tabular-nums">₱{numpadBuffer || "0"}</p>
              </div>
              {numpad}
            </div>
          </>
        )}

        {/* Success overlay */}
        {showSuccess && <SuccessOverlay onDone={handleSuccessDone} />}
      </DialogContent>
    </Dialog>
  );
}
