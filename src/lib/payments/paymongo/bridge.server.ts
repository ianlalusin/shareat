import "server-only";
import type { ParsedQr } from "@/lib/payments/paymongo/qrph";
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
