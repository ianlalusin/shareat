// Pure helpers for PaymentModal (audit F03/F04/F05). Kept free of React and
// Firebase so they can be unit-tested in the node vitest environment.
import type { ModeOfPayment } from "@/lib/types";
import type { CheckoutPayment as Payment } from "@/components/cashier/gatewayTenders";

// ---------------------------------------------------------------------------
// F05 — prior-payment recovery (reservation deposits + paid QR intents)
// ---------------------------------------------------------------------------

export type RecoveryState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "failed"; message: string };

export interface ReservationPaymentLike {
  id: string;
  methodId: string;
  amount: number | string;
  reference?: string | null;
  voidedAt?: unknown;
}

export interface ReservationLike {
  paymentsAppliedToSessionId?: string | null;
  payments?: ReservationPaymentLike[] | null;
}

export interface PaidIntentLike {
  id: string;
  status: string;
  methodId: string;
  amount: number | string;
  paymongoPaymentId?: string | null;
  paymongoIntentId: string;
}

export interface RecoveryLoaders {
  /** Resolves null when the reservation doc does not exist. Throws on read failure. */
  loadReservation?: () => Promise<ReservationLike | null>;
  /** All bridge docs for this session. Throws on read failure. */
  loadSessionIntents: () => Promise<PaidIntentLike[]>;
}

export type RecoveryResult =
  | { ok: true; prepaidLines: Payment[]; reservationApplied: boolean }
  | { ok: false; message: string };

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Loads money the customer already paid before this checkout. A failure is
 * reported as `ok: false` — never as "no prior payments" — so the modal can
 * block collection instead of offering the full bill as a new cash tender.
 */
export async function recoverPriorPayments(
  sessionId: string,
  loaders: RecoveryLoaders,
): Promise<RecoveryResult> {
  const prepaidLines: Payment[] = [];
  let reservationApplied = false;
  const problems: string[] = [];

  if (loaders.loadReservation) {
    try {
      const r = await loaders.loadReservation();
      if (r) {
        reservationApplied = r.paymentsAppliedToSessionId === sessionId;
        if (!reservationApplied) {
          for (const rp of r.payments ?? []) {
            if (!rp || rp.voidedAt) continue;
            if (!rp.id || !rp.methodId) throw new Error("Reservation payment record is incomplete.");
            prepaidLines.push({
              id: `rp-${rp.id}`,
              methodId: rp.methodId,
              amount: round2(Number(rp.amount)),
              reference: rp.reference ?? "",
              fromReservationPaymentId: rp.id,
            });
          }
        }
      }
    } catch (e) {
      problems.push(`reservation deposits (${errorText(e)})`);
    }
  }

  try {
    const intents = await loaders.loadSessionIntents();
    const seenRefs = new Set(prepaidLines.map(p => p.reference).filter(Boolean));
    for (const data of intents) {
      if (data.status !== "paid") continue;
      const reference = data.paymongoPaymentId ?? data.paymongoIntentId;
      if (!reference || !data.methodId) throw new Error("Paid QR record is incomplete.");
      if (seenRefs.has(reference)) continue;
      seenRefs.add(reference);
      prepaidLines.push({
        id: `qr-${data.id}`,
        methodId: data.methodId,
        amount: round2(Number(data.amount)),
        reference,
        intentDocId: data.id,
      });
    }
  } catch (e) {
    problems.push(`QR Ph payments (${errorText(e)})`);
  }

  if (problems.length > 0) {
    return { ok: false, message: `Could not check earlier payments: ${problems.join("; ")}.` };
  }
  return { ok: true, prepaidLines, reservationApplied };
}

function errorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return "unknown error";
}

export function defaultMethodId(paymentMethods: ModeOfPayment[]): string {
  const cash = paymentMethods.find(pm => pm.type === "cash");
  return cash?.id || (paymentMethods.length > 0 ? paymentMethods[0].id : "");
}

/** Seeds the tender rows: prior payments first, then one default row for any balance. */
export function buildInitialTenders(
  prepaidLines: Payment[],
  grandTotal: number,
  paymentMethods: ModeOfPayment[],
  newId: string,
): Payment[] {
  const seededCents = prepaidLines.reduce((s, p) => s + Math.round((Number(p.amount) || 0) * 100), 0);
  const remainingCents = Math.max(0, Math.round(grandTotal * 100) - seededCents);
  const methodId = defaultMethodId(paymentMethods);
  if (prepaidLines.length === 0) {
    return [{ id: newId, methodId, amount: round2(grandTotal), reference: "" }];
  }
  if (remainingCents > 0) {
    return [...prepaidLines, { id: newId, methodId, amount: remainingCents / 100, reference: "" }];
  }
  return prepaidLines;
}

// ---------------------------------------------------------------------------
// F04 — initialize once per open; reconcile later snapshots without wiping
// ---------------------------------------------------------------------------

/** One key per modal-open transaction. Equal keys must never re-seed tenders. */
export function tenderInitKey(open: boolean, storeId: string, sessionId: string, reservationId?: string | null): string | null {
  if (!open) return null;
  return `${storeId}|${sessionId}|${reservationId ?? ""}`;
}

/**
 * A later payment-methods snapshot only fills in rows that had no method yet
 * (methods were still loading at open). Entered amounts are never touched.
 * Returns the same array when nothing changes.
 */
export function fillMissingMethods(payments: Payment[], paymentMethods: ModeOfPayment[]): Payment[] {
  const fallback = defaultMethodId(paymentMethods);
  if (!fallback || !payments.some(p => !p.methodId)) return payments;
  return payments.map(p => (p.methodId ? p : { ...p, methodId: fallback }));
}

/** Non-null when the bill total moved since tenders were seeded / last acknowledged. */
export function dueChangeNotice(baselineCents: number | null, currentCents: number): { fromCents: number; toCents: number } | null {
  if (baselineCents === null || baselineCents === currentCents) return null;
  return { fromCents: baselineCents, toCents: currentCents };
}

// ---------------------------------------------------------------------------
// F03 — commit first; nothing after a committed sale may report "failed"
// ---------------------------------------------------------------------------

/** Rejects if `p` does not settle within `ms` (the underlying work is not cancelled). */
export function withTimeout<T>(p: Promise<T>, ms: number, label = "Request"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

export type CheckoutOutcome =
  | { phase: "failed"; error: string }
  | { phase: "committed"; receiptId: string; redirect: string; warnings: string[] };

export interface CheckoutSteps {
  /** Records the sale. Throwing here means NOTHING was committed. */
  commit: () => Promise<string>;
  /** Reads autoprint preference. Allowed to fail — falls back to no autoprint. */
  readAutoPrint: () => Promise<boolean>;
  /** Best-effort follow-ups (reservation marking, PIN, loyalty...). Each may fail. */
  afterCommit?: Array<{ label: string; run: (receiptId: string) => Promise<void> }>;
}

/**
 * Runs checkout in two phases. Only a `commit` failure yields `failed`; once a
 * receipt id exists every later failure becomes a warning on a committed
 * outcome, so the UI can never return to an unpaid / re-collect state.
 */
export async function runCheckout(steps: CheckoutSteps): Promise<CheckoutOutcome> {
  let receiptId: string;
  try {
    receiptId = await steps.commit();
    if (!receiptId) throw new Error("Checkout did not return a receipt.");
  } catch (e) {
    return { phase: "failed", error: errorText(e) === "unknown error" ? "Something went wrong." : errorText(e) };
  }

  const warnings: string[] = [];
  let autoPrint = false;
  try {
    autoPrint = await steps.readAutoPrint();
  } catch {
    warnings.push("Receipt print settings could not be loaded, so the receipt will not print automatically. Use Print on the receipt page.");
  }
  for (const step of steps.afterCommit ?? []) {
    try {
      await step.run(receiptId);
    } catch {
      warnings.push(`${step.label} did not finish. The sale is saved; retry or notify a manager.`);
    }
  }
  return {
    phase: "committed",
    receiptId,
    redirect: `/receipt?id=${encodeURIComponent(receiptId)}${autoPrint ? "&autoprint=1" : ""}`,
    warnings,
  };
}
