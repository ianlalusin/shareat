import "server-only";
import type { ParsedQr, WebhookEvent } from "@/lib/payments/paymongo/qrph";
import type { PosPaymentIntentDoc } from "@/lib/types";

export const TEN_MINUTES_MS = 10 * 60 * 1000;

export function buildInitialIntentDoc(input: {
  intentDocId: string;
  storeId: string;
  sessionId: string;
  amount: number;
  amountCentavos: number;
  methodId: string;
  createdByUid: string;
  createdByLocalUserId: string | null;
  parsed: ParsedQr;
  nowMs: number;
}): PosPaymentIntentDoc {
  return {
    id: input.intentDocId,
    storeId: input.storeId,
    sessionId: input.sessionId,
    provider: "paymongo_qrph",
    amount: input.amount,
    amountCentavos: input.amountCentavos,
    paymongoIntentId: input.parsed.paymongoIntentId,
    paymongoPaymentId: null,
    qrData: input.parsed.qrData,
    imageUrl: input.parsed.imageUrl,
    status: "awaiting_payment",
    createdAtMs: input.nowMs,
    expiresAtMs: input.parsed.expiresAtFromApiMs ?? input.nowMs + TEN_MINUTES_MS,
    processedEventIds: [],
    methodId: input.methodId,
    createdByLocalUserId: input.createdByLocalUserId,
    createdByUid: input.createdByUid,
  };
}

// ===== Task 8: Idempotent webhook → intent-doc reducer =====

/** Only PHP is chargeable through the POS QR Ph flow. */
export const BRIDGE_CURRENCY = "PHP";

/**
 * Why a signed payment.paid event must NOT settle this bridge, or null when it
 * matches. The signature proves the event came from PayMongo, not that it is
 * for this bridge's amount: the intent id, amount (centavos) and currency must
 * all equal what create-qr stored (audit B24).
 */
export function paidEventMismatch(doc: PosPaymentIntentDoc, ev: WebhookEvent): string | null {
  if (!ev.paymentIntentId || ev.paymentIntentId !== doc.paymongoIntentId) return "intent_mismatch";
  if (ev.amountCentavos === null) return "amount_missing";
  if (ev.amountCentavos !== doc.amountCentavos) return "amount_mismatch";
  if (ev.currency === null) return "currency_missing";
  if (ev.currency.toUpperCase() !== BRIDGE_CURRENCY) return "currency_mismatch";
  return null;
}

export function applyWebhookToIntentDoc(
  doc: PosPaymentIntentDoc,
  ev: WebhookEvent,
): { changed: boolean; next: PosPaymentIntentDoc; rejected?: string } {
  if (ev.eventId && doc.processedEventIds.includes(ev.eventId)) return { changed: false, next: doc };
  if (doc.status === "paid") return { changed: false, next: doc }; // terminal-positive: never downgrade
  const processedEventIds = ev.eventId ? [...doc.processedEventIds, ev.eventId] : doc.processedEventIds;
  if (ev.type === "payment.paid") {
    // Validate BEFORE any transition; a mismatch is not recorded as processed
    // so a redelivery (or a corrected bridge) can still be evaluated.
    const rejected = paidEventMismatch(doc, ev);
    if (rejected) return { changed: false, next: doc, rejected };
    return { changed: true, next: { ...doc, status: "paid", paymongoPaymentId: ev.paymentId, processedEventIds } };
  }
  if (ev.type === "payment.failed") {
    if (ev.paymentIntentId && ev.paymentIntentId !== doc.paymongoIntentId) return { changed: false, next: doc };
    return { changed: true, next: { ...doc, status: "failed", processedEventIds } };
  }
  return { changed: false, next: doc };
}
