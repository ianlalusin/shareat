import "server-only";
import {
  buildPaymentIntentBody,
  buildPaymentMethodBody,
  buildAttachBody,
  parseAttachResponse,
  type ParsedQr,
  type QrhpMetadata,
} from "@/lib/payments/paymongo/qrph";

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
    throw new Error(`PayMongo ${path} failed (${res.status}): ${JSON.stringify(json)}`);
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
