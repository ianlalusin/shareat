// ===== Task 1: Money conversion + amount validation =====

/** PayMongo QR Ph minimum chargeable amount, in centavos. Verify before go-live. */
export const MIN_QRPH_AMOUNT_CENTAVOS = 2000;

/** Convert a peso float to integer centavos, rounding away float artifacts. */
export function pesosToCentavos(pesos: number): number {
  return Math.round(pesos * 100);
}

/** Throw if the centavo amount is not a positive integer at or above the minimum. */
export function assertPayableAmount(centavos: number): void {
  if (!Number.isInteger(centavos)) {
    throw new Error(`Amount must be whole centavos, got ${centavos}`);
  }
  if (centavos < MIN_QRPH_AMOUNT_CENTAVOS) {
    throw new Error(
      `Amount ${centavos} is below the QR Ph minimum of ${MIN_QRPH_AMOUNT_CENTAVOS} centavos`,
    );
  }
}

// ===== Task 2: Request builders =====

export type QrhpMetadata = {
  storeId: string;
  sessionId: string;
  intentDocId: string;
  kind: "pos_session";
};

export function buildPaymentIntentBody(input: {
  amountCentavos: number;
  description: string;
  metadata: QrhpMetadata;
}): object {
  return {
    data: {
      attributes: {
        amount: input.amountCentavos,
        currency: "PHP",
        capture_type: "automatic",
        payment_method_allowed: ["qrph"],
        description: input.description,
        metadata: input.metadata,
      },
    },
  };
}

export function buildPaymentMethodBody(input: {
  name: string;
  email?: string;
  phone?: string;
}): object {
  const billing: Record<string, string> = { name: input.name };
  if (input.email) billing.email = input.email;
  if (input.phone) billing.phone = input.phone;
  return { data: { attributes: { type: "qrph", billing } } };
}

export function buildAttachBody(paymentMethodId: string): object {
  return { data: { attributes: { payment_method: paymentMethodId } } };
}
