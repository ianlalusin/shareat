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

export function applyWebhookToIntentDoc(
  doc: PosPaymentIntentDoc,
  ev: WebhookEvent,
): { changed: boolean; next: PosPaymentIntentDoc } {
  if (ev.eventId && doc.processedEventIds.includes(ev.eventId)) return { changed: false, next: doc };
  if (doc.status === "paid") return { changed: false, next: doc }; // terminal-positive: never downgrade
  const processedEventIds = ev.eventId ? [...doc.processedEventIds, ev.eventId] : doc.processedEventIds;
  if (ev.type === "payment.paid") {
    return { changed: true, next: { ...doc, status: "paid", paymongoPaymentId: ev.paymentId, processedEventIds } };
  }
  if (ev.type === "payment.failed") {
    return { changed: true, next: { ...doc, status: "failed", processedEventIds } };
  }
  return { changed: false, next: doc };
}
