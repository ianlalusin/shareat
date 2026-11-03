"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, X, Loader2, CheckCircle2, AlertTriangle, RotateCw } from "lucide-react";
import { Numpad } from "@/components/shared/Numpad";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useIsMobile } from "@/hooks/use-mobile";
import { collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { completePaymentFromUnits } from "@/components/cashier/firestore";
import { completePaymentOffline } from "@/components/cashier/offlinePayment";
import type { ModeOfPayment, Store, Reservation, PosPaymentIntentDoc } from "@/lib/types";
// CheckoutPayment = Payment + intentDocId (the PayMongo bridge doc a QR tender settles against).
import type { CheckoutPayment as Payment } from "@/components/cashier/gatewayTenders";
import type { AppUser } from "@/context/auth-context";
import type { User } from "firebase/auth";
import { reservationEvent, appendReservationEvent } from "@/lib/reservations/history";
import { isPaymongoQrMethod, shouldOfferPaymongoQr } from "@/lib/payments/paymongo/gateway";
import { useLocalProfile } from "@/context/local-profile-context";
import { PaymongoQrView, type QrAttempt } from "@/components/cashier/paymongo-qr-view";
import {
  buildInitialTenders,
  dueChangeNotice,
  fillMissingMethods,
  recoverPriorPayments,
  runCheckout,
  tenderInitKey,
  withTimeout,
  type CheckoutOutcome,
  type RecoveryState,
} from "@/components/cashier/payment-modal-logic";
import { SessionCardBanner } from "@/components/cashier/SessionCardBanner";

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
    if (isPaymongoQrMethod(methodDetails) && (!p.reference || String(p.reference).trim().length === 0)) {
      return "Scan-to-pay tender isn't paid yet — generate the QR and wait for payment.";
    }
  }
  const totalPaidCents = payments.reduce((s, p) => s + Math.round(Number(p.amount || 0) * 100), 0);
  if (totalPaidCents < grandTotalCents - 1) {
    return `Payment is not enough. Balance: ₱${((grandTotalCents - totalPaidCents) / 100).toFixed(2)}`;
  }
  const changeCents = Math.max(0, totalPaidCents - grandTotalCents);
  if (changeCents > 1) {
    const cashIds = new Set(
      paymentMethods
        .filter(pm => String(pm.type || "").toLowerCase() === "cash" || String(pm.name || "").toLowerCase().includes("cash"))
        .map(pm => pm.id)
    );
    const cashPaidCents = payments
      .filter(p => cashIds.has(p.methodId))
      .reduce((s, p) => s + Math.round(Number(p.amount || 0) * 100), 0);
    if (cashPaidCents < changeCents) {
      return "Overpayment must be covered by Cash so change can be issued.";
    }
  }
  return null;
}

// --- Success Overlay ---
// Shown for every committed sale. Later receipt/print/follow-up problems are
// listed here as warnings — never as "Payment failed" (audit F03).
function SuccessOverlay({ onDone, warnings, offline }: { onDone: () => void; warnings: string[]; offline: boolean }) {
  const hasWarnings = warnings.length > 0;
  useEffect(() => {
    // With warnings, wait for the cashier to read them before moving on.
    if (hasWarnings) return;
    const timer = setTimeout(onDone, 2500);
    return () => clearTimeout(timer);
  }, [onDone, hasWarnings]);

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/95 rounded-lg p-6 text-center animate-in fade-in-0 zoom-in-95 duration-300"
      role="status"
      aria-live="polite"
    >
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping" />
        <CheckCircle2 className="h-16 w-16 text-green-500 relative" aria-hidden />
      </div>
      <p className="mt-4 text-lg font-semibold text-green-600">Payment Successful</p>
      <p className="text-sm text-muted-foreground mt-1">
        {offline ? "Saved on this device — it will sync when back online." : "Generating receipt..."}
      </p>
      {hasWarnings && (
        <div role="alert" className="mt-3 max-w-sm rounded-md border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">The sale is paid. Some follow-up steps need attention:</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {warnings.map(w => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}
      <Button variant={hasWarnings ? "default" : "ghost"} size="sm" className={`mt-4 h-11 lg:h-9 ${hasWarnings ? "" : "text-muted-foreground"}`} onClick={onDone}>
        {hasWarnings ? "Open receipt to print" : "Close"}
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
  activeStore: Store;
  appUser: AppUser;
  firebaseUser: User | null;
  paymentMethods: ModeOfPayment[];
  /** When the session was seated from a reservation, allow pre-applying any
   *  reservation payments logged before bill-out. */
  reservationId?: string | null;
}

export function PaymentModal({
  open,
  onOpenChange,
  grandTotal,
  sessionId,
  storeId,
  activeStore,
  appUser,
  firebaseUser,
  paymentMethods,
  reservationId,
}: PaymentModalProps) {
  const router = useRouter();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  // One checkout command id per modal opening (audit P1 idempotent retry).
  const checkoutOpIdRef = useRef<string>(uuidv4());
  const isMobile = useIsMobile();
  const { currentProfile } = useLocalProfile();

  const [payments, setPayments] = useState<Payment[]>([]);
  // Row currently being resolved via the PayMongo QR overlay. While this is
  // set, that tender is NOT part of `payments` (it's pulled out on
  // generation and only re-added — with a fresh id — once actually paid),
  // so the existing multi-tender total/validation/complete logic never has
  // to know about it. `resumeIntentDocId` re-checks an earlier QR instead of
  // minting a new one.
  const [qrTender, setQrTender] = useState<{ id: string; methodId: string; amount: number; resumeIntentDocId?: string } | null>(null);
  // A QR the cashier stepped away from whose payment is not confirmed either
  // way. Blocks re-collection (Confirm / new QR) until it resolves (F06/F07).
  const [qrAttempt, setQrAttempt] = useState<{ intentDocId: string; rowId: string; methodId: string; amount: number } | null>(null);
  const [qrAttemptError, setQrAttemptError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
  // Set once a sale is committed. From then on the modal never returns to an
  // unpaid / re-collect state (F03).
  const [outcome, setOutcome] = useState<(Extract<CheckoutOutcome, { phase: "committed" }> & { offline: boolean }) | null>(null);
  // Track which payment row the numpad controls
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  // Raw string buffer for the numpad-driven amount
  const [numpadBuffer, setNumpadBuffer] = useState<string>("");

  const [reservationApplied, setReservationApplied] = useState(false);
  // Prior-payment recovery status (F05). Collection is blocked unless "ready".
  const [recovery, setRecovery] = useState<RecoveryState>({ status: "loading" });
  const [recoveryNonce, setRecoveryNonce] = useState(0);
  // Bill total the tenders were seeded against / last acknowledged (F04).
  const [dueBaselineCents, setDueBaselineCents] = useState<number | null>(null);
  const amountRefs = useRef(new Map<string, HTMLButtonElement>());

  // Latest bill/config values, read at seed time without re-running the seed.
  const latestRef = useRef({ grandTotal, paymentMethods });
  latestRef.current = { grandTotal, paymentMethods };
  const outcomeRef = useRef(outcome);
  outcomeRef.current = outcome;

  // Initialize payment rows ONCE per modal open (store/session/reservation
  // key). Later bill-total or payment-method snapshots never re-seed, wipe
  // entered tenders or touch the processing lock (F04). If the session was
  // seated from a reservation, pre-seed one line per non-voided reservation
  // payment, plus any already-paid QR intents, then a cash row for the rest.
  // A failed lookup is surfaced and blocks collection — it never silently
  // becomes a full cash tender (F05).
  const initKey = tenderInitKey(open, storeId, sessionId, reservationId);
  useEffect(() => {
    if (!initKey || outcomeRef.current) return;
    let cancelled = false;
    setRecovery({ status: "loading" });
    setPayments([]);
    setActivePaymentId(null);
    setNumpadBuffer("");
    setReservationApplied(false);
    setDueBaselineCents(null);
    setQrAttempt(null);
    setQrAttemptError(null);
    setShowSuccess(false);
    setPendingRedirect(null);
    (async () => {
      const result = await recoverPriorPayments(sessionId, {
        loadReservation: reservationId
          ? async () => {
              const snap = await getDoc(doc(db, "stores", storeId, "reservations", reservationId));
              return snap.exists() ? (snap.data() as Reservation) : null;
            }
          : undefined,
        // Recover PayMongo QR payments already confirmed paid (by the webhook) for this
        // session but not yet finalized — so closing the payment modal doesn't lose a
        // payment the customer already made. They come back as locked tenders on (re)open.
        loadSessionIntents: async () => {
          const qrSnap = await getDocs(
            query(collection(db, "stores", storeId, "paymentIntents"), where("sessionId", "==", sessionId)),
          );
          return qrSnap.docs.map(d => ({ ...(d.data() as PosPaymentIntentDoc), id: d.id }));
        },
      });
      if (cancelled) return;
      if (!result.ok) {
        setRecovery({ status: "failed", message: result.message });
        return;
      }
      const { grandTotal: gt, paymentMethods: pms } = latestRef.current;
      const lines = buildInitialTenders(result.prepaidLines, gt, pms, `pay-${Date.now()}`);
      setReservationApplied(result.reservationApplied);
      setPayments(lines);
      const focus = lines[lines.length - 1];
      setActivePaymentId(focus?.id ?? null);
      setNumpadBuffer(focus && focus.amount > 0 ? focus.amount.toFixed(2).replace(/\.?0+$/, "") : "");
      setDueBaselineCents(Math.round(gt * 100));
      setRecovery({ status: "ready" });
    })();
    return () => { cancelled = true; };
  }, [initKey, recoveryNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Methods that arrive after open only fill rows that had no method yet.
  useEffect(() => {
    setPayments(prev => fillMissingMethods(prev, paymentMethods));
  }, [paymentMethods]);

  const grandTotalCents = Math.round(grandTotal * 100);
  const dueNotice = recovery.status === "ready" && !outcome ? dueChangeNotice(dueBaselineCents, grandTotalCents) : null;
  const totalPaid = useMemo(() => payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0), [payments]);
  const totalPaidCents = Math.round(totalPaid * 100);
  const remainingCents = grandTotalCents - totalPaidCents;
  const remainingBalance = Math.max(0, remainingCents) / 100;
  const change = Math.max(0, -remainingCents) / 100;
  const hasUnpaidGatewayRow = payments.some(p => {
    const methodDetails = paymentMethods.find(pm => pm.id === p.methodId);
    return !!methodDetails && isPaymongoQrMethod(methodDetails) && (!p.reference || String(p.reference).trim().length === 0);
  });
  const recoveryReady = recovery.status === "ready";
  // Editing is locked while recovery is unresolved, during checkout and after commit.
  const editLocked = isProcessing || !recoveryReady || !!outcome;
  const canComplete = grandTotalCents > 0 && remainingCents <= 1 && !hasUnpaidGatewayRow
    && recoveryReady && !dueNotice && !qrAttempt && !outcome;

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
    const next = payments.filter(p => p.id !== id);
    setPayments(prev => prev.filter(p => p.id !== id));
    const target = activePaymentId === id ? next[0] : next.find(p => p.id === activePaymentId) ?? next[0];
    if (activePaymentId === id && target) {
      setActivePaymentId(target.id);
      setNumpadBuffer(target.amount.toString());
    }
    // Keyboard users: move focus to a remaining row instead of losing it (F20).
    if (target) setTimeout(() => amountRefs.current.get(target.id)?.focus(), 0);
  };

  const updatePayment = (id: string, updates: Partial<Payment>) => {
    setPayments(prev => prev.map(p => (p.id === id ? { ...p, ...updates } : p)));
  };

  // Focus a payment row for numpad input — dismiss keyboard
  const focusPayment = (id: string) => {
    // Blur a focused text field to dismiss the virtual keyboard. Buttons keep
    // focus so keyboard users stay on the row they selected (F20).
    const el = document.activeElement;
    if (el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
      el.blur();
    }
    setActivePaymentId(id);
    const p = payments.find(p => p.id === id);
    if (p) setNumpadBuffer(p.amount > 0 ? p.amount.toString() : "");
  };

  // Numpad handlers
  const handleNumpadKey = (key: string) => {
    if (!activePaymentId || editLocked) return;
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
    if (!activePaymentId || editLocked) return;
    setNumpadBuffer(prev => {
      const next = prev.slice(0, -1);
      const num = parseFloat(next);
      updatePayment(activePaymentId, { amount: isNaN(num) || next === "" ? 0 : num });
      return next;
    });
  };

  const handleNumpadClear = () => {
    if (!activePaymentId || editLocked) return;
    setNumpadBuffer("");
    updatePayment(activePaymentId, { amount: 0 });
  };

  // --- PayMongo QR tender ---
  // Pulls the row out of `payments` (it isn't a real tender until it's
  // actually paid) and opens the QR overlay for that exact amount/method.
  const startQrTender = (payment: Payment) => {
    // Never mint a second QR while an earlier one might still be paid.
    if (editLocked || payment.amount <= 0 || qrAttempt) return;
    setQrTender({ id: payment.id, methodId: payment.methodId, amount: payment.amount });
    setPayments(prev => prev.filter(p => p.id !== payment.id));
    if (activePaymentId === payment.id) {
      setActivePaymentId(null);
      setNumpadBuffer("");
    }
  };

  // Bridge doc confirmed payment: add a fresh tender row carrying the
  // PayMongo payment id as its reference, then close the overlay so it sits
  // in the list like any other tender. Feeds the SAME completePaymentFromUnits
  // path via the normal Confirm Payment button — no second completion path.
  const handleQrPaid = useCallback(({ amount, reference, intentDocId }: { amount: number; reference: string; intentDocId: string }) => {
    if (!qrTender) return;
    const newId = `pay-qr-${Date.now()}`;
    setPayments(prev => prev.some(p => p.intentDocId === intentDocId)
      ? prev
      : [...prev, { id: newId, methodId: qrTender.methodId, amount, reference, intentDocId }]);
    setQrTender(null);
    setQrAttempt(null);
    setQrAttemptError(null);
  }, [qrTender]);

  // Back to bill: restore the exact row that was pulled out (same id, no
  // reference) so nothing is added. If the QR might still be paid, keep the
  // attempt so it keeps being tracked and re-collection stays blocked.
  const handleQrCancel = useCallback((attempt?: QrAttempt) => {
    if (!qrTender) return;
    setPayments(prev => [...prev, { id: qrTender.id, methodId: qrTender.methodId, amount: qrTender.amount, reference: "" }]);
    setActivePaymentId(qrTender.id);
    setNumpadBuffer(qrTender.amount > 0 ? qrTender.amount.toString() : "");
    setQrAttempt(attempt?.unresolved
      ? { intentDocId: attempt.intentDocId, rowId: qrTender.id, methodId: qrTender.methodId, amount: qrTender.amount }
      : null);
    setQrAttemptError(null);
    setQrTender(null);
  }, [qrTender]);

  // Re-open the status screen for the pending attempt (no new QR is minted).
  const resumeQrAttempt = () => {
    if (!qrAttempt || editLocked) return;
    setQrTender({ id: qrAttempt.rowId, methodId: qrAttempt.methodId, amount: qrAttempt.amount, resumeIntentDocId: qrAttempt.intentDocId });
    setPayments(prev => prev.filter(p => p.id !== qrAttempt.rowId));
    if (activePaymentId === qrAttempt.rowId) {
      setActivePaymentId(null);
      setNumpadBuffer("");
    }
  };

  // While back on the bill, keep listening to the pending attempt so a late
  // payment lands as a locked tender instead of being collected twice.
  useEffect(() => {
    if (!qrAttempt || qrTender) return;
    const { intentDocId, rowId, methodId, amount } = qrAttempt;
    const unsub = onSnapshot(
      doc(db, `stores/${storeId}/paymentIntents/${intentDocId}`),
      (snap) => {
        setQrAttemptError(null);
        const d = snap.data() as PosPaymentIntentDoc | undefined;
        if (!d) return;
        if (d.status === "paid") {
          const reference = d.paymongoPaymentId ?? d.paymongoIntentId;
          setPayments(prev => {
            if (prev.some(p => p.intentDocId === intentDocId)) return prev;
            const paid: Payment = { id: `pay-qr-${Date.now()}`, methodId, amount, reference, intentDocId };
            return prev.some(p => p.id === rowId) ? prev.map(p => (p.id === rowId ? paid : p)) : [...prev, paid];
          });
          setActivePaymentId(cur => (cur === rowId ? null : cur));
          setQrAttempt(null);
          toast({ title: "QR Ph payment received", description: `₱${amount.toFixed(2)} was paid and added to the bill.` });
        } else if (d.status === "failed" || d.status === "canceled") {
          setQrAttempt(null);
        }
      },
      (err) => setQrAttemptError(`Live QR updates stopped (${err?.message ?? "connection error"}). Use Check QR.`),
    );
    return () => unsub();
  }, [qrAttempt, qrTender, storeId, toast]);

  const handleSuccessDone = useCallback(() => {
    if (pendingRedirect) {
      router.push(pendingRedirect);
    }
  }, [pendingRedirect, router]);

  const handleComplete = async () => {
    if (isProcessing || outcome) return;

    if (!canComplete) {
      const why = recovery.status !== "ready"
        ? "Earlier payments are still being checked. Wait or tap Retry."
        : qrAttempt
          ? "A QR Ph payment may still be paid. Check it before collecting again."
          : dueNotice
            ? "The bill total changed. Check the payments and tap OK first."
            : null;
      if (why) {
        toast({ variant: "destructive", title: "Cannot Complete", description: why });
        return;
      }
    }
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
    const usesReservationPayments = !!reservationId && normalizedPayments.some(p => !!p.fromReservationPaymentId);
    const markReservationApplied = () => updateDoc(doc(db, "stores", storeId, "reservations", reservationId!), {
      paymentsAppliedToSessionId: sessionId,
      history: appendReservationEvent(reservationEvent(
        "payments_applied",
        { uid: appUser?.uid ?? null, name: appUser?.displayName || appUser?.name || null },
        `Applied to session ${sessionId}`,
      )),
      updatedAt: serverTimestamp(),
    });
    // Print preference only. A failure/timeout falls back to no autoprint and
    // is reported as a print warning — the sale is already recorded (F03).
    const readAutoPrint = async () => {
      const settingsSnap = await withTimeout(getDoc(doc(db, "stores", storeId, "receiptSettings", "main")), 5000, "Receipt settings");
      return settingsSnap.exists() && !!settingsSnap.data()?.autoPrintAfterPayment;
    };
    const finish = (result: CheckoutOutcome, offline: boolean) => {
      if (result.phase === "failed") {
        // Nothing was committed — safe to let staff fix and retry.
        toast({ variant: "destructive", title: "Payment failed", description: result.error });
        setIsProcessing(false);
        return;
      }
      // Committed: keep the processing lock; show success (+ any print warnings).
      setOutcome({ ...result, offline });
      setShowSuccess(true);
      setPendingRedirect(result.redirect);
    };

    // --- OFFLINE ---
    if (!isOnline) {
      const result = await runCheckout({
        commit: async () => {
          const { receiptId, receiptNumber } = await completePaymentOffline(
            storeId, sessionId, appUser, normalizedPayments,
            activeStore, paymentMethods, grandTotal,
          );
          console.info(`[PaymentModal] Offline sale recorded — receipt ${receiptNumber}`);
          return receiptId;
        },
        readAutoPrint,
        afterCommit: usesReservationPayments
          ? [{
              label: "Marking the reservation deposit as used",
              // Local-first: this write never gets a server ack while offline, so
              // awaiting it would hang the modal on "Processing..." forever.
              run: async () => {
                void markReservationApplied().catch((e) => console.warn("[offline] reservation payments-applied marking failed", e));
              },
            }]
          : [],
      });
      finish(result, true);
      return;
    }

    // --- ONLINE ---
    // Server command (audit P1): totals, receipt number, gateway consumption,
    // PIN archive, voucher finalize and loyalty earn all run server-side (the
    // last three from the posEffects outbox, retried by cron). `checkoutOpIdRef`
    // stays the same across retries so a timed-out attempt is replayed, not
    // charged twice.
    const result = await runCheckout({
      commit: async () =>
        completePaymentFromUnits(
          storeId, sessionId, appUser, normalizedPayments,
          activeStore, paymentMethods, grandTotal, checkoutOpIdRef.current,
        ),
      readAutoPrint,
      // History entry on the reservation (the server already set
      // paymentsAppliedToSessionId atomically with the receipt).
      afterCommit: usesReservationPayments
        ? [{ label: "Marking the reservation deposit as used", run: async () => { await markReservationApplied(); } }]
        : [],
    });
    finish(result, false);
  };

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const confirmLabel = isProcessing ? (
    <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Processing...</>
  ) : "Confirm Payment";

  // --- Payment form (shared between layouts) ---
  const paymentForm = (
    <div className="flex flex-col min-h-0 flex-1">
      <DialogHeader className="pb-2">
        <DialogTitle>Complete Payment</DialogTitle>
        <DialogDescription>
          Total due: <span className="font-semibold text-foreground text-base">₱{fmt(grandTotal)}</span>
        </DialogDescription>
      </DialogHeader>

      <SessionCardBanner
        storeId={storeId}
        sessionId={sessionId}
        grandTotal={grandTotal}
        loyaltyConfig={activeStore.loyaltyConfig}
        canLink={appUser?.role === "admin" || appUser?.role === "manager" || appUser?.role === "cashier"}
      />

      {/* Prior-payment recovery status (F05) */}
      {recovery.status === "loading" && (
        <div role="status" className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking earlier payments (deposits, QR Ph)…
        </div>
      )}
      {recovery.status === "failed" && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2">
          <p className="flex items-start gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            Can&apos;t take payment yet
          </p>
          <p className="text-muted-foreground">
            {recovery.message} The customer may already have paid part of this bill, so collecting now could charge them twice.
            Retry, or ask a manager to check the reservation / QR Ph records.
          </p>
          <Button type="button" variant="outline" size="sm" className="h-11 lg:h-9" onClick={() => setRecoveryNonce(n => n + 1)}>
            <RotateCw className="mr-2 h-4 w-4" aria-hidden /> Retry
          </Button>
        </div>
      )}

      {/* Bill total changed after the tenders were set up (F04) */}
      {dueNotice && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 space-y-2">
          <p>
            The bill total changed from <strong>₱{fmt(dueNotice.fromCents / 100)}</strong> to <strong>₱{fmt(dueNotice.toCents / 100)}</strong>.
            Your entered payments were kept — check them before confirming.
          </p>
          <Button type="button" variant="outline" size="sm" className="h-11 lg:h-9" onClick={() => setDueBaselineCents(grandTotalCents)}>
            OK, I checked
          </Button>
        </div>
      )}

      {/* QR left unresolved: still tracked, re-collection blocked (F06/F07) */}
      {qrAttempt && !qrTender && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 space-y-2">
          <p>
            A QR Ph payment of <strong>₱{fmt(qrAttempt.amount)}</strong> may still be paid. It will be added automatically if it
            arrives. Don&apos;t collect this amount another way until it&apos;s checked.
          </p>
          {qrAttemptError && <p className="text-destructive">{qrAttemptError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="h-11 lg:h-9" onClick={resumeQrAttempt} disabled={editLocked}>
              Check QR payment
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 lg:h-9"
              onClick={() => { setQrAttempt(null); setQrAttemptError(null); }}
              disabled={editLocked}
            >
              Customer did not pay — clear
            </Button>
          </div>
        </div>
      )}

      {/* Scrollable payment rows */}
      <div className="flex-1 overflow-y-auto space-y-2 py-2 min-h-0" role="group" aria-label="Payments">
        {payments.map((payment) => {
          const method = paymentMethods.find(pm => pm.id === payment.methodId);
          const methodName = method?.name ?? "Payment";
          const isActive = activePaymentId === payment.id;
          const fromReservation = !!payment.fromReservationPaymentId;
          const isGatewayRow = method ? isPaymongoQrMethod(method) : false;
          // A gateway row that carries a reference is PAID — real captured money.
          // Lock it: no amount edit, no delete, no method change. Other tenders can
          // still be added/edited freely.
          const isPaidGatewayRow = isGatewayRow && !!payment.reference;
          const shownAmount = isActive && !isPaidGatewayRow ? (numpadBuffer || "0") : payment.amount.toFixed(2);
          return (
            <div
              key={payment.id}
              className={`rounded-lg border p-2.5 ${isPaidGatewayRow ? "cursor-default" : "cursor-pointer"} transition-colors ${isActive ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border"} ${(method?.hasRef || isGatewayRow) ? "space-y-2" : ""}`}
              onClick={() => { if (!isPaidGatewayRow && !editLocked) focusPayment(payment.id); }}
            >
              {fromReservation && (
                <div className="text-[10px] uppercase tracking-wide text-primary font-medium mb-1">From reservation</div>
              )}
              <div className="flex items-center gap-1.5">
                <Select value={payment.methodId} onValueChange={(val) => updatePayment(payment.id, { methodId: val })} disabled={editLocked || isPaidGatewayRow}>
                  <SelectTrigger className="h-11 lg:h-9 min-w-0 flex-1 text-sm" aria-label={`Payment method, currently ${methodName}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {paymentMethods.filter(m => shouldOfferPaymongoQr(m, isOnline)).map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/* Amount — a focusable toggle that selects which tender the numpad
                    edits. Enter/Space selects; digits, ".", Backspace and Delete
                    type into the selected tender. No virtual keyboard (F20). */}
                <button
                  type="button"
                  ref={(el) => { if (el) amountRefs.current.set(payment.id, el); else amountRefs.current.delete(payment.id); }}
                  aria-pressed={isActive}
                  aria-label={`${methodName} amount ₱${shownAmount}${isPaidGatewayRow ? ", paid and locked" : isActive ? ", selected for numpad entry" : ", select to edit with the numpad"}`}
                  disabled={editLocked || isPaidGatewayRow}
                  onClick={(e) => { e.stopPropagation(); focusPayment(payment.id); }}
                  onKeyDown={(e) => {
                    if (!isActive) return;
                    if (/^[0-9]$/.test(e.key) || e.key === ".") { e.preventDefault(); handleNumpadKey(e.key); }
                    else if (e.key === "Backspace") { e.preventDefault(); handleNumpadBackspace(); }
                    else if (e.key === "Delete") { e.preventDefault(); handleNumpadClear(); }
                  }}
                  className={`flex items-center h-11 lg:h-9 rounded-md border px-2.5 text-sm tabular-nums select-none w-[120px] shrink-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${isActive ? "border-primary bg-background" : "bg-muted/50"}`}
                >
                  <span className="text-muted-foreground text-xs mr-0.5" aria-hidden>₱</span>
                  <span className="flex-1 truncate" aria-hidden>{shownAmount}</span>
                </button>
                {payments.length > 1 && !isPaidGatewayRow && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-11 w-11 lg:h-8 lg:w-8 text-muted-foreground"
                    aria-label={`Remove ${methodName} payment of ₱${payment.amount.toFixed(2)}`}
                    onClick={(e) => { e.stopPropagation(); removePayment(payment.id); }}
                    disabled={editLocked}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </div>
              {isGatewayRow && !isPaidGatewayRow && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full h-11 lg:h-9 text-sm"
                  onClick={(e) => { e.stopPropagation(); startQrTender(payment); }}
                  disabled={editLocked || payment.amount <= 0 || !isOnline || !!qrAttempt}
                >
                  Generate QR Ph — ₱{payment.amount.toFixed(2)}
                </Button>
              )}
              {isPaidGatewayRow && (
                <div className="flex items-center justify-center gap-1.5 h-9 text-sm font-medium text-green-600">
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Paid via QR Ph — locked
                </div>
              )}
              {!isGatewayRow && method?.hasRef && (
                <Input
                  placeholder="Reference #"
                  aria-label={`${methodName} reference number`}
                  value={payment.reference || ""}
                  onChange={(e) => updatePayment(payment.id, { reference: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  disabled={editLocked}
                  className="h-11 lg:h-9 text-sm"
                />
              )}
            </div>
          );
        })}

        {remainingBalance > 0.01 && !editLocked && (
          <Button variant="outline" size="sm" onClick={addPayment} className="w-full h-11 lg:h-9">
            <PlusCircle className="mr-2 h-4 w-4" aria-hidden /> Split Payment
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
      isProcessing={editLocked}
    />
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isProcessing && !showSuccess && !qrTender && !qrAttempt) onOpenChange(v); }}>
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

        {/* PayMongo QR overlay — covers the form while a gateway tender is in flight */}
        {qrTender && (
          <PaymongoQrView
            storeId={storeId}
            sessionId={sessionId}
            methodId={qrTender.methodId}
            amount={qrTender.amount}
            localUserId={currentProfile?.profileId ?? null}
            resumeIntentDocId={qrTender.resumeIntentDocId ?? null}
            onPaid={handleQrPaid}
            onCancel={handleQrCancel}
          />
        )}

        {/* Success overlay */}
        {showSuccess && <SuccessOverlay onDone={handleSuccessDone} warnings={outcome?.warnings ?? []} offline={!!outcome?.offline} />}
      </DialogContent>
    </Dialog>
  );
}
