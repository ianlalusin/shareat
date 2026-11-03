import { createHmac, timingSafeEqual } from "node:crypto";

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
  /**
   * Correlation for recovery (audit B24/P4). PayMongo metadata accepts string
   * values only, so the revision is sent as a string. Optional so intents
   * created before this change still parse.
   */
  attemptId?: string;
  operationId?: string;
  billingRevision?: string;
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

// ===== Task 3: Attach response parser =====

export type ParsedQr = {
  paymongoIntentId: string;
  qrData: string | null;
  imageUrl: string | null;
  expiresAtFromApiMs: number | null;
};

export function parseAttachResponse(json: unknown): ParsedQr {
  const data = (json as any)?.data;
  const attrs = data?.attributes;
  const code = attrs?.next_action?.code;
  if (!data?.id || !code || (!code.data && !code.image_url)) {
    throw new Error("PayMongo attach response has no QR code next_action");
  }
  const expSec = typeof code.expires_at === "number" ? code.expires_at : null;
  return {
    paymongoIntentId: String(data.id),
    qrData: code.data ?? null,
    imageUrl: code.image_url ?? null,
    expiresAtFromApiMs: expSec == null ? null : expSec * 1000,
  };
}

// ===== Task 4: Webhook signature verification + event parsing =====

function parseSignatureHeader(header: string): { t: string; te?: string; li?: string } | null {
  const parts = header.split(",").map((p) => p.trim());
  const out: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq > 0) out[p.slice(0, eq)] = p.slice(eq + 1);
  }
  if (!out.t || (!out.te && !out.li)) return null;
  return { t: out.t, te: out.te, li: out.li };
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;
  const expected = createHmac("sha256", secret).update(`${parsed.t}.${rawBody}`).digest("hex");
  return (
    (parsed.te ? safeEqualHex(parsed.te, expected) : false) ||
    (parsed.li ? safeEqualHex(parsed.li, expected) : false)
  );
}

export type WebhookEvent = {
  eventId: string;
  type: string;
  paymentId: string | null;
  paymentIntentId: string | null;
  status: string | null;
  /** Payment amount in centavos as signed by PayMongo; null when absent/non-integer. */
  amountCentavos: number | null;
  currency: string | null;
  metadata: Partial<QrhpMetadata>;
};

export function parseWebhookEvent(json: unknown): WebhookEvent {
  const ev = (json as any)?.data;
  const evAttrs = ev?.attributes ?? {};
  const resource = evAttrs?.data ?? {};
  const rAttrs = resource?.attributes ?? {};
  return {
    eventId: String(ev?.id ?? ""),
    type: String(evAttrs?.type ?? ""),
    paymentId: resource?.id ? String(resource.id) : null,
    paymentIntentId: rAttrs?.payment_intent_id ? String(rAttrs.payment_intent_id) : null,
    status: rAttrs?.status ? String(rAttrs.status) : null,
    amountCentavos: Number.isInteger(rAttrs?.amount) ? Number(rAttrs.amount) : null,
    currency: typeof rAttrs?.currency === "string" ? rAttrs.currency : null,
    metadata: (rAttrs?.metadata ?? {}) as Partial<QrhpMetadata>,
  };
}
