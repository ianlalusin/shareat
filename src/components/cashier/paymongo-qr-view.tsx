"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { db, auth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import type { PosPaymentIntentDoc } from "@/lib/types";
import {
  QR_CREATE_TIMEOUT_MS,
  checkQrStatus,
  expiryVerdict,
  serverClockOffsetMs,
  shouldListenForPayment,
  type StatusCheckResult,
} from "@/components/cashier/paymongo-qr-logic";

type Phase = "creating" | "awaiting" | "paid" | "expired" | "failed" | "error";

/** Handed back when the cashier leaves while an intent may still be paid. */
export interface QrAttempt {
  intentDocId: string;
  /** true unless PayMongo confirmed nothing was paid (or the intent failed). */
  unresolved: boolean;
}

interface PaymongoQrViewProps {
  storeId: string;
  sessionId: string;
  methodId: string;
  amount: number; // pesos — the QR portion of the bill
  localUserId: string | null;
  /** Re-check an existing intent instead of minting a new QR. */
  resumeIntentDocId?: string | null;
  /** Fired exactly once, only after the bridge doc confirms `status === "paid"`. */
  onPaid: (info: { amount: number; reference: string; intentDocId: string }) => void;
  /**
   * Fired when the cashier goes back to the bill. Caller must add NOTHING to the
   * tender set; when `attempt.unresolved` it must keep tracking that intent.
   */
  onCancel: (attempt?: QrAttempt) => void;
}

// Touch targets: 44px on phone/tablet, compact on desktop (lg ≥ 1024px).
const ACTION = "h-11 min-w-[44px] lg:h-9";

/**
 * Cashier-facing overlay for a single PayMongo QR Ph tender.
 *
 * Mints a QR intent on mount (bounded by a timeout), renders the QR with a
 * countdown, and listens to the bridge doc
 * (`stores/{storeId}/paymentIntents/{intentDocId}`) for the webhook-driven
 * status flip. The listener stays on after the countdown ends so late payments
 * are still accepted, and expiry triggers an authoritative status check before
 * the screen says nothing was paid. Only calls `onPaid` once the bridge doc
 * itself reports `status === "paid"`.
 */
export function PaymongoQrView({
  storeId,
  sessionId,
  methodId,
  amount,
  localUserId,
  resumeIntentDocId,
  onPaid,
  onCancel,
}: PaymongoQrViewProps) {
  const [phase, setPhase] = useState<Phase>(resumeIntentDocId ? "expired" : "creating");
  const [qrData, setQrData] = useState<string | null>(null);
  // PayMongo may return a hosted/base64 QR image instead of a raw EMV string.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number>(0);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [intentDocId, setIntentDocId] = useState<string | null>(resumeIntentDocId ?? null);
  const [listenerError, setListenerError] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusResult, setStatusResult] = useState<StatusCheckResult | null>(null);
  const paidRef = useRef(false);
  const [paidSeen, setPaidSeen] = useState(false);
  const paidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createAbortRef = useRef<AbortController | null>(null);
  // Clear the "payment received" hold timer if we somehow unmount first.
  useEffect(() => () => { if (paidTimerRef.current) clearTimeout(paidTimerRef.current); }, []);

  // Keep the latest onPaid without re-subscribing the snapshot listener on
  // every parent re-render (the parent's callback identity can change).
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  // 1. Mint the QR once on mount (skipped when resuming an existing intent).
  useEffect(() => {
    if (resumeIntentDocId) return;
    let aborted = false;
    let timedOut = false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    createAbortRef.current = controller;
    const timer = setTimeout(() => { timedOut = true; controller?.abort(); }, QR_CREATE_TIMEOUT_MS);
    (async () => {
      setPhase("creating");
      setErrorMessage(null);
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/pos/paymongo/create-qr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ storeId, sessionId, amount, methodId, localUserId }),
          signal: controller?.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.reason || body?.error || `Could not start the QR Ph payment (${res.status}).`);
        }
        const data = await res.json();
        if (aborted) return;
        if (!data?.intentDocId || !data?.expiresAtMs || !(data.qrData || data.imageUrl)) {
          throw new Error("The server returned an incomplete QR. No QR was shown, so nothing could have been paid.");
        }
        setClockOffsetMs(serverClockOffsetMs(res.headers?.get?.("date"), Date.now()));
        setIntentDocId(data.intentDocId);
        setQrData(data.qrData ?? null);
        setImageUrl(data.imageUrl ?? null);
        setExpiresAtMs(data.expiresAtMs);
        setPhase("awaiting");
      } catch (e: any) {
        if (aborted) return;
        setErrorMessage(
          timedOut
            ? "Starting the QR took too long. No QR was shown, so nothing could have been paid. Go back and try again."
            : (e?.message ?? "Could not start the QR Ph payment."),
        );
        setPhase("error");
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      aborted = true;
      clearTimeout(timer);
      controller?.abort();
    };
    // Intentionally excludes onCancel/onPaid — this effect only mints the QR.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, sessionId, methodId, amount, localUserId, resumeIntentDocId]);

  // 2. Listen to the bridge doc for the webhook-driven status flip. Stays
  // subscribed for any unresolved intent, including after local expiry (F06).
  useEffect(() => {
    if (!shouldListenForPayment(intentDocId, paidSeen)) return;
    // Bridge doc is TOP-LEVEL per store: stores/{storeId}/paymentIntents/{id}
    const ref = doc(db, `stores/${storeId}/paymentIntents/${intentDocId}`);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setListenerError(null);
        const d = snap.data() as PosPaymentIntentDoc | undefined;
        if (!d || paidRef.current) return;
        if (d.status === "paid") {
          paidRef.current = true;
          setPaidSeen(true);
          setPhase("paid");
          // Hold on the "Payment received" state briefly so the cashier sees the
          // confirmation, THEN hand the tender back (onPaid unmounts this overlay).
          // handleQrPaid is guarded on qrTender, so a late fire is safe.
          // intentDocId lets checkout re-read this bridge doc in its transaction (audit B03).
          const info = { amount, reference: d.paymongoPaymentId ?? d.paymongoIntentId, intentDocId: snap.id };
          paidTimerRef.current = setTimeout(() => onPaidRef.current(info), 1800);
        } else if (d.status === "failed" || d.status === "canceled") {
          setPhase("failed");
        } else if (d.status === "expired") {
          setPhase("expired");
        }
      },
      (err) => {
        setListenerError(`Live payment updates stopped (${err?.message ?? "connection error"}). Use Check status.`);
      },
    );
    return () => unsub();
  }, [intentDocId, paidSeen, storeId, amount]);

  // 3. Countdown + client-side display expiry. Expiry only retires the QR on
  // screen; the listener above keeps running.
  useEffect(() => {
    if (phase !== "awaiting" || !expiresAtMs) return;
    const tick = () => {
      const left = expiresAtMs - (Date.now() + clockOffsetMs);
      setRemainingMs(Math.max(0, left));
      if (left <= 0) setPhase("expired");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, expiresAtMs, clockOffsetMs]);

  // 4. Authoritative status check (manual, and automatic on expiry). The
  // listener stays the only path to onPaid; this reports what PayMongo says.
  const checkingRef = useRef(false);
  const checkStatus = useCallback(async () => {
    if (!intentDocId || checkingRef.current) return;
    checkingRef.current = true;
    setCheckingStatus(true);
    try {
      let token: string | undefined;
      try { token = await auth.currentUser?.getIdToken(); } catch { token = undefined; }
      const result = await checkQrStatus(fetch, { storeId, sessionId, intentDocId }, token);
      setStatusResult(result);
    } finally {
      checkingRef.current = false;
      setCheckingStatus(false);
    }
  }, [intentDocId, storeId, sessionId]);

  const autoCheckedRef = useRef(false);
  useEffect(() => {
    if (phase !== "expired" || autoCheckedRef.current || !intentDocId) return;
    autoCheckedRef.current = true;
    setStatusResult(null);
    void checkStatus();
  }, [phase, intentDocId, checkStatus]);

  const verdict = expiryVerdict(statusResult);
  const backToBill = () => {
    createAbortRef.current?.abort();
    if (!intentDocId) return onCancel();
    const resolved = phase === "failed" || (statusResult !== null && verdict.kind === "not_paid");
    onCancel({ intentDocId, unresolved: !resolved });
  };

  const mmss = `${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0")}`;
  const statusLine = statusResult
    ? statusResult.ok
      ? statusResult.status === "paid"
        ? "PayMongo reports paid — confirming…"
        : "PayMongo: still waiting for payment."
      : statusResult.message
    : null;

  return (
    <div
      className="absolute inset-0 z-50 overflow-y-auto bg-background/95 rounded-lg animate-in fade-in-0 zoom-in-95 duration-300"
      role="region"
      aria-label="QR Ph payment"
    >
      {/* min-h-full + justify-center centers when it fits and SCROLLS (no clipping of
          the QR or the Check status / Cancel buttons) when the modal is short. */}
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center" aria-live="polite">
      {phase === "creating" && (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Starting QR Ph…</p>
          <Button type="button" variant="ghost" size="sm" className={ACTION} onClick={backToBill}>
            Back to bill
          </Button>
        </>
      )}

      {phase === "awaiting" && (qrData || imageUrl) && (
        // Wide screens: QR on the left, amount/timer/actions stacked on the right
        // (no scrolling). Narrow: stacks vertically.
        <div className="flex w-full flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
          <div className="shrink-0 rounded-lg border bg-white p-3">
            {qrData ? (
              <QRCodeSVG value={qrData} size={220} title="QR Ph code" />
            ) : (
              // PayMongo-hosted (or base64) QR image when no raw EMV string is returned.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl!} alt="PayMongo QR Ph code" width={220} height={220} />
            )}
          </div>
          <div className="flex flex-col items-center gap-2 text-center sm:items-start sm:text-left">
            <p className="text-sm text-muted-foreground">Scan with any QR Ph app to pay</p>
            <p className="text-3xl font-bold tabular-nums">₱{amount.toFixed(2)}</p>
            <p className="text-sm tabular-nums text-muted-foreground">Expires in {mmss}</p>
            <div className="mt-1 flex gap-2">
              <Button type="button" variant="outline" size="sm" className={ACTION} onClick={checkStatus} disabled={checkingStatus}>
                {checkingStatus && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Check status
              </Button>
              <Button type="button" variant="ghost" size="sm" className={ACTION} onClick={backToBill}>
                Back to bill
              </Button>
            </div>
            {statusLine && <p className={`text-xs ${statusResult && !statusResult.ok ? "text-destructive" : "text-muted-foreground"}`}>{statusLine}</p>}
          </div>
        </div>
      )}

      {phase === "paid" && (
        <>
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping" />
            <CheckCircle2 className="h-16 w-16 text-green-500 relative" aria-hidden />
          </div>
          <p className="text-lg font-semibold text-green-600">Payment received</p>
          <p className="text-sm text-muted-foreground">₱{amount.toFixed(2)} via QR Ph</p>
        </>
      )}

      {phase === "expired" && (
        <>
          {verdict.kind === "not_paid" ? (
            <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden />
          ) : (
            <Loader2 className={`h-10 w-10 text-muted-foreground ${checkingStatus || verdict.kind === "paid" ? "animate-spin" : ""}`} aria-hidden />
          )}
          <p className="font-medium text-amber-600">{resumeIntentDocId ? "Earlier QR Ph payment" : "QR expired"}</p>
          {verdict.kind === "not_paid" && (
            <p className="text-sm text-muted-foreground">PayMongo shows no payment for this QR. Still listening in case a late payment arrives.</p>
          )}
          {verdict.kind === "paid" && (
            <p className="text-sm text-muted-foreground">PayMongo reports this QR as paid. Waiting for confirmation…</p>
          )}
          {verdict.kind === "unknown" && (
            <p className={`text-sm ${statusResult ? "text-destructive" : "text-muted-foreground"}`}>
              {statusResult ? verdict.message : "Checking whether the customer paid…"}
            </p>
          )}
          <div className="mt-1 flex gap-2">
            {verdict.kind !== "not_paid" && (
              <Button type="button" variant="outline" size="sm" className={ACTION} onClick={checkStatus} disabled={checkingStatus}>
                {checkingStatus && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Check again
              </Button>
            )}
            <Button type="button" variant={verdict.kind === "not_paid" ? "outline" : "ghost"} size="sm" className={ACTION} onClick={backToBill}>
              Back to bill
            </Button>
          </div>
        </>
      )}

      {(phase === "failed" || phase === "error") && (
        <>
          <XCircle className="h-10 w-10 text-red-500" aria-hidden />
          <p className="font-medium text-red-600">Payment could not be completed</p>
          {errorMessage && <p className="text-sm text-muted-foreground">{errorMessage}</p>}
          <Button type="button" variant="outline" size="sm" onClick={backToBill} className={`mt-1 ${ACTION}`}>
            Back to bill
          </Button>
        </>
      )}

      {listenerError && phase !== "paid" && (
        <p role="alert" className="text-xs text-destructive">{listenerError}</p>
      )}
      </div>
    </div>
  );
}
