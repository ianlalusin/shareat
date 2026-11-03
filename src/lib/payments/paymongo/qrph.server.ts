import "server-only";
import {
  buildPaymentIntentBody,
  buildPaymentMethodBody,
  buildAttachBody,
  parseAttachResponse,
  type ParsedQr,
  type QrhpMetadata,
} from "@/lib/payments/paymongo/qrph";
import type { PosPaymentIntentDoc } from "@/lib/types";

export type PostJson = (path: string, body: object, opts?: { idempotencyKey?: string }) => Promise<unknown>;

const PAYMONGO_BASE = "https://api.paymongo.com";

/**
 * PayMongo answered with a non-2xx status, i.e. the request reached the API.
 * Anything else thrown by postJson/getJson (network error, timeout) is
 * AMBIGUOUS: the provider may or may not have acted on it.
 */
export class PaymongoHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PaymongoHttpError";
  }
}

/**
 * A 4xx that PayMongo stores against an idempotency key, so replaying the same
 * key would only replay the failure. 409 (concurrent request on the same key)
 * and 429 store nothing and are safe to retry with the same key.
 * https://docs.paymongo.com/reference/idempotent-requests
 */
export function isDefinitiveProviderRejection(e: unknown): boolean {
  return e instanceof PaymongoHttpError && e.status >= 400 && e.status < 500 && e.status !== 409 && e.status !== 429;
}

export const defaultPostJson: PostJson = async (path, body, opts) => {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error("PAYMONGO_SECRET_KEY is not configured");
  const auth = Buffer.from(`${key}:`).toString("base64");
  const res = await fetch(`${PAYMONGO_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Surface PayMongo's human-readable error detail (e.g. "qrph is not enabled",
    // "amount below the minimum") — NOT the raw body (which may carry internal fields).
    const detail = (json as any)?.errors?.[0]?.detail;
    throw new PaymongoHttpError(detail ? `PayMongo: ${detail}` : `PayMongo request failed (${res.status})`, res.status);
  }
  return json;
};

export async function createQrPaymentViaApi(
  deps: { postJson: PostJson },
  input: {
    amountCentavos: number;
    description: string;
    metadata: QrhpMetadata;
    billing: { name: string; email?: string };
  },
): Promise<ParsedQr> {
  const intent = (await deps.postJson(
    "/v1/payment_intents",
    buildPaymentIntentBody({
      amountCentavos: input.amountCentavos,
      description: input.description,
      metadata: input.metadata,
    }),
  )) as any;
  const intentId = intent?.data?.id as string;
  if (!intentId) throw new Error("PayMongo did not return a payment intent id");

  const method = (await deps.postJson(
    "/v1/payment_methods",
    buildPaymentMethodBody(input.billing),
  )) as any;
  const methodId = method?.data?.id as string;
  if (!methodId) throw new Error("PayMongo did not return a payment method id");

  const attached = await deps.postJson(
    `/v1/payment_intents/${intentId}/attach`,
    buildAttachBody(methodId),
  );
  return parseAttachResponse(attached);
}

export type GetJson = (path: string) => Promise<unknown>;

export const defaultGetJson: GetJson = async (path) => {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error("PAYMONGO_SECRET_KEY is not configured");
  const auth = Buffer.from(`${key}:`).toString("base64");
  const res = await fetch(`${PAYMONGO_BASE}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new PaymongoHttpError(`PayMongo GET ${path} failed (${res.status})`, res.status);
  return json;
};

export function mapIntentStatusToDocStatus(
  paymongoStatus: string,
): PosPaymentIntentDoc["status"] | null {
  switch (paymongoStatus) {
    case "succeeded":
      return "paid";
    case "awaiting_next_action":
    case "processing":
    case "awaiting_payment_method":
      return "awaiting_payment";
    default:
      return null;
  }
}

export async function getPaymentIntentViaApi(
  deps: { getJson: GetJson },
  intentId: string,
): Promise<RetrievedIntent> {
  return parseRetrievedIntent(await deps.getJson(`/v1/payment_intents/${intentId}`));
}

export type RetrievedIntent = {
  status: string;
  latestPaymentId: string | null;
  metadata: Record<string, unknown>;
  amountCentavos: number | null;
  currency: string | null;
  /** The QR still carried in next_action, when the intent has one. */
  qr: ParsedQr | null;
};

function parseRetrievedIntent(json: any): RetrievedIntent {
  const attrs = json?.data?.attributes ?? {};
  const payments = attrs?.payments ?? [];
  const latest = Array.isArray(payments) && payments.length ? payments[payments.length - 1] : null;
  const metadata =
    attrs?.metadata && typeof attrs.metadata === "object" ? (attrs.metadata as Record<string, unknown>) : {};
  let qr: ParsedQr | null = null;
  try {
    qr = parseAttachResponse(json);
  } catch {
    qr = null;
  }
  return {
    status: String(attrs?.status ?? ""),
    latestPaymentId: latest?.id ?? null,
    metadata,
    amountCentavos: Number.isInteger(attrs?.amount) ? Number(attrs.amount) : null,
    currency: typeof attrs?.currency === "string" ? attrs.currency : null,
    qr,
  };
}

// ===== B24 / audit P4: recoverable create -> method -> attach =====
//
// Provider semantics this relies on, checked against PayMongo's official docs
// on 2026-11-03:
// - https://docs.paymongo.com/reference/idempotent-requests
//   `Idempotency-Key` header; "Idempotency applies to resource creation
//   requests only"; the first result (success or failure) is stored and
//   replayed; keys expire after 24 hours; differing parameters under the same
//   key are rejected; a request that "fails validation or conflicts with
//   another concurrent request" stores nothing and can be retried. Keys are
//   therefore sent on POST /v1/payment_intents and POST /v1/payment_methods only.
// - https://docs.paymongo.com/reference/attach-to-paymentintent.md documents no
//   idempotency for attach, so an ambiguous attach is reconciled by retrieving
//   the intent instead of being blindly repeated.
// - https://docs.paymongo.com/reference/get_payment_intent-1.md
//   GET /v1/payment_intents/{id} returns amount, currency, status, metadata and
//   next_action, and is "the only way back to next_action once the attach
//   response that carried it is lost".
// - https://docs.paymongo.com/reference/create-a-paymentintent.md metadata
//   accepts string values only.

export type QrCreateResult =
  | { kind: "qr"; parsed: ParsedQr; attachNo: number; paymentMethodId: string | null }
  /** The intent already left the payable state (paid/processing); no QR to show. */
  | { kind: "in_progress"; paymongoIntentId: string; status: string; attachNo: number };

/** The saved intent is not ours (metadata/amount mismatch): never resume it. */
export class IntentCorrelationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntentCorrelationError";
  }
}

function assertIntentIsOurs(intent: RetrievedIntent, input: { amountCentavos: number; metadata: QrhpMetadata }) {
  const m = intent.metadata;
  const want = input.metadata;
  if (
    m.kind !== want.kind ||
    m.storeId !== want.storeId ||
    m.sessionId !== want.sessionId ||
    m.intentDocId !== want.intentDocId ||
    (want.attemptId !== undefined && m.attemptId !== want.attemptId) ||
    intent.amountCentavos !== input.amountCentavos ||
    intent.currency !== "PHP"
  ) {
    throw new IntentCorrelationError("Saved PayMongo intent does not match this attempt");
  }
}

/**
 * Create, or resume, the PayMongo QR for one durable attempt.
 *
 * - No known intent id: create with `intentIdempotencyKey`. A retry after an
 *   ambiguous create replays the same key and gets the SAME intent back.
 *   `onIntentCreated` must durably persist the id before this continues.
 * - Known intent id: retrieve it and verify it is ours; reuse a QR still in
 *   next_action, otherwise attach a fresh payment method.
 * - An ambiguous or rejected attach is reconciled by retrieving the intent.
 */
export async function createOrResumeQrViaApi(
  deps: { postJson: PostJson; getJson: GetJson },
  input: {
    amountCentavos: number;
    description: string;
    metadata: QrhpMetadata;
    billing: { name: string; email?: string };
    intentIdempotencyKey: string;
    knownIntentId: string | null;
    attachNo: number;
    onIntentCreated: (paymongoIntentId: string) => Promise<void>;
  },
): Promise<QrCreateResult> {
  let attachNo = input.attachNo;
  let intentId = input.knownIntentId;

  if (intentId) {
    const current = await getPaymentIntentViaApi(deps, intentId);
    assertIntentIsOurs(current, input);
    if (current.status === "awaiting_next_action" && current.qr) {
      return { kind: "qr", parsed: { ...current.qr, paymongoIntentId: intentId }, attachNo, paymentMethodId: null };
    }
    if (current.status === "succeeded" || current.status === "processing") {
      return { kind: "in_progress", paymongoIntentId: intentId, status: current.status, attachNo };
    }
    if (current.status !== "awaiting_payment_method" && current.status !== "awaiting_next_action") {
      // e.g. cancelled: this intent can never be paid; the caller starts a new generation.
      throw new PaymongoHttpError(`PayMongo intent ${intentId} is ${current.status || "unknown"}`, 410);
    }
    // A method was attached but its QR is not retrievable: attach a NEW method
    // (replaying the previous method key would return the same one).
    if (current.status === "awaiting_next_action") attachNo += 1;
  } else {
    const intent = (await deps.postJson(
      "/v1/payment_intents",
      buildPaymentIntentBody({
        amountCentavos: input.amountCentavos,
        description: input.description,
        metadata: input.metadata,
      }),
      { idempotencyKey: input.intentIdempotencyKey },
    )) as any;
    intentId = intent?.data?.id as string;
    if (!intentId) throw new Error("PayMongo did not return a payment intent id");
    // A replayed key returns the FIRST stored intent; make sure it is this one.
    if (intent?.data?.attributes) assertIntentIsOurs(parseRetrievedIntent(intent), input);
    await input.onIntentCreated(intentId);
  }

  const method = (await deps.postJson(
    "/v1/payment_methods",
    buildPaymentMethodBody(input.billing),
    { idempotencyKey: `${input.intentIdempotencyKey}-pm${attachNo}` },
  )) as any;
  const methodId = method?.data?.id as string;
  if (!methodId) throw new Error("PayMongo did not return a payment method id");

  try {
    const attached = await deps.postJson(`/v1/payment_intents/${intentId}/attach`, buildAttachBody(methodId));
    return { kind: "qr", parsed: parseAttachResponse(attached), attachNo, paymentMethodId: methodId };
  } catch (attachErr) {
    // Ambiguous, or rejected (e.g. a replayed create whose method was already
    // attached): the intent itself says whether a QR exists.
    let current: RetrievedIntent;
    try {
      current = await getPaymentIntentViaApi(deps, intentId);
    } catch {
      throw attachErr;
    }
    assertIntentIsOurs(current, input);
    if (current.status === "awaiting_next_action" && current.qr) {
      return { kind: "qr", parsed: { ...current.qr, paymongoIntentId: intentId }, attachNo, paymentMethodId: methodId };
    }
    if (current.status === "succeeded" || current.status === "processing") {
      return { kind: "in_progress", paymongoIntentId: intentId, status: current.status, attachNo };
    }
    throw attachErr;
  }
}
