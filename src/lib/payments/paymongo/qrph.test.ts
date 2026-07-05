import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  pesosToCentavos,
  assertPayableAmount,
  MIN_QRPH_AMOUNT_CENTAVOS,
  buildPaymentIntentBody,
  buildPaymentMethodBody,
  buildAttachBody,
  parseAttachResponse,
  verifyWebhookSignature,
  parseWebhookEvent,
} from "@/lib/payments/paymongo/qrph";

// ===== Task 1: Money conversion + amount validation =====

describe("pesosToCentavos", () => {
  it("converts whole and fractional pesos to integer centavos", () => {
    expect(pesosToCentavos(850)).toBe(85000);
    expect(pesosToCentavos(20)).toBe(2000);
    expect(pesosToCentavos(199.99)).toBe(19999);
  });

  it("rounds float artifacts to the nearest centavo", () => {
    expect(pesosToCentavos(0.1 + 0.2)).toBe(30); // 0.30000000000000004
  });
});

describe("assertPayableAmount", () => {
  it("accepts amounts at or above the minimum", () => {
    expect(() => assertPayableAmount(MIN_QRPH_AMOUNT_CENTAVOS)).not.toThrow();
    expect(() => assertPayableAmount(85000)).not.toThrow();
  });

  it("rejects amounts below the minimum, zero, negatives, and non-integers", () => {
    expect(() => assertPayableAmount(MIN_QRPH_AMOUNT_CENTAVOS - 1)).toThrow();
    expect(() => assertPayableAmount(0)).toThrow();
    expect(() => assertPayableAmount(-100)).toThrow();
    expect(() => assertPayableAmount(1000.5)).toThrow();
  });
});

// ===== Task 2: Request builders =====

describe("buildPaymentIntentBody", () => {
  it("wraps attributes with qrph allowed, PHP, automatic capture, and metadata", () => {
    const body = buildPaymentIntentBody({
      amountCentavos: 85000,
      description: "SHT session sess_1",
      metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "pi_doc_1", kind: "pos_session" },
    });
    expect(body).toEqual({
      data: {
        attributes: {
          amount: 85000,
          currency: "PHP",
          capture_type: "automatic",
          payment_method_allowed: ["qrph"],
          description: "SHT session sess_1",
          metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "pi_doc_1", kind: "pos_session" },
        },
      },
    });
  });
});

describe("buildPaymentMethodBody", () => {
  it("builds a qrph payment method with billing", () => {
    expect(buildPaymentMethodBody({ name: "Shareat SHT", email: "pos@shareat.net" })).toEqual({
      data: { attributes: { type: "qrph", billing: { name: "Shareat SHT", email: "pos@shareat.net" } } },
    });
  });

  it("omits undefined billing fields", () => {
    const body = buildPaymentMethodBody({ name: "Shareat SHT" }) as any;
    expect(body.data.attributes.billing).toEqual({ name: "Shareat SHT" });
  });
});

describe("buildAttachBody", () => {
  it("wraps the payment method id", () => {
    expect(buildAttachBody("pm_123")).toEqual({
      data: { attributes: { payment_method: "pm_123" } },
    });
  });
});

// ===== Task 3: Attach response parser =====

const attachOk = {
  data: {
    id: "pi_abc",
    attributes: {
      status: "awaiting_next_action",
      next_action: {
        type: "present_qr_code",
        code: {
          type: "qrph",
          data: "00020101021226...6304ABCD",
          image_url: "https://paymongo.example/qr/pi_abc.png",
          expires_at: 1751690400, // unix seconds
        },
      },
    },
  },
};

describe("parseAttachResponse", () => {
  it("extracts intent id, qr data, image url, and expiry (ms)", () => {
    expect(parseAttachResponse(attachOk)).toEqual({
      paymongoIntentId: "pi_abc",
      qrData: "00020101021226...6304ABCD",
      imageUrl: "https://paymongo.example/qr/pi_abc.png",
      expiresAtFromApiMs: 1751690400000,
    });
  });

  it("returns null expiry when PayMongo omits expires_at", () => {
    const noExp = structuredClone(attachOk);
    delete (noExp.data.attributes.next_action.code as any).expires_at;
    expect(parseAttachResponse(noExp).expiresAtFromApiMs).toBeNull();
  });

  it("throws when there is no QR next_action", () => {
    expect(() => parseAttachResponse({ data: { id: "pi_x", attributes: { status: "awaiting_payment_method" } } })).toThrow();
  });
});

// ===== Task 4: Webhook signature verification + event parsing =====

const SECRET = "whsk_test_secret";
const RAW = JSON.stringify({ hello: "world" });
function sign(ts: string, body: string, field: "te" | "li") {
  const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},${field}=${sig}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a valid test-mode (te) signature", () => {
    expect(verifyWebhookSignature(RAW, sign("1751690400", RAW, "te"), SECRET)).toBe(true);
  });
  it("accepts a valid live-mode (li) signature", () => {
    expect(verifyWebhookSignature(RAW, sign("1751690400", RAW, "li"), SECRET)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(RAW + "x", sign("1751690400", RAW, "li"), SECRET)).toBe(false);
  });
  it("rejects a wrong secret", () => {
    expect(verifyWebhookSignature(RAW, sign("1751690400", RAW, "li"), "other")).toBe(false);
  });
  it("rejects a malformed header", () => {
    expect(verifyWebhookSignature(RAW, "garbage", SECRET)).toBe(false);
  });
});

describe("parseWebhookEvent", () => {
  it("pulls event id, type, payment id, intent id, status, and metadata", () => {
    const evt = {
      data: {
        id: "evt_1",
        attributes: {
          type: "payment.paid",
          data: {
            id: "pay_1",
            attributes: {
              status: "paid",
              payment_intent_id: "pi_abc",
              metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "d1", kind: "pos_session" },
            },
          },
        },
      },
    };
    expect(parseWebhookEvent(evt)).toEqual({
      eventId: "evt_1",
      type: "payment.paid",
      paymentId: "pay_1",
      paymentIntentId: "pi_abc",
      status: "paid",
      metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "d1", kind: "pos_session" },
    });
  });
});
