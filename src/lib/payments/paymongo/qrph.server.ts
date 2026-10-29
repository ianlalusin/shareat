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

export type PostJson = (path: string, body: object) => Promise<unknown>;

const PAYMONGO_BASE = "https://api.paymongo.com";

export const defaultPostJson: PostJson = async (path, body) => {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error("PAYMONGO_SECRET_KEY is not configured");
  const auth = Buffer.from(`${key}:`).toString("base64");
  const res = await fetch(`${PAYMONGO_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Surface PayMongo's human-readable error detail (e.g. "qrph is not enabled",
    // "amount below the minimum") — NOT the raw body (which may carry internal fields).
    const detail = (json as any)?.errors?.[0]?.detail;
    throw new Error(detail ? `PayMongo: ${detail}` : `PayMongo request failed (${res.status})`);
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
  if (!res.ok) throw new Error(`PayMongo GET ${path} failed (${res.status})`);
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
): Promise<{ status: string; latestPaymentId: string | null; metadata: Record<string, unknown> }> {
  const json = (await deps.getJson(`/v1/payment_intents/${intentId}`)) as any;
  const attrs = json?.data?.attributes ?? {};
  const payments = attrs?.payments ?? [];
  const latest = Array.isArray(payments) && payments.length ? payments[payments.length - 1] : null;
  const metadata =
    attrs?.metadata && typeof attrs.metadata === "object" ? (attrs.metadata as Record<string, unknown>) : {};
  return { status: String(attrs?.status ?? ""), latestPaymentId: latest?.id ?? null, metadata };
}
