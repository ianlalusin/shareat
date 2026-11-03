import { describe, it, expect } from "vitest";
import { buildInitialIntentDoc, TEN_MINUTES_MS, applyWebhookToIntentDoc } from "@/lib/payments/paymongo/bridge.server";
import type { PosPaymentIntentDoc } from "@/lib/types";
import type { WebhookEvent } from "@/lib/payments/paymongo/qrph";

describe("buildInitialIntentDoc", () => {
  it("uses PayMongo expiry when present, else now + 10min", () => {
    const base = {
      intentDocId: "d1", storeId: "SHT", sessionId: "sess_1",
      amount: 850, amountCentavos: 85000, methodId: "mop_1",
      createdByUid: "uid_1", createdByLocalUserId: "lu_1",
      parsed: { paymongoIntentId: "pi_1", qrData: "00020...", imageUrl: null, expiresAtFromApiMs: null },
      nowMs: 1_000_000,
    };
    expect(buildInitialIntentDoc(base).expiresAtMs).toBe(1_000_000 + TEN_MINUTES_MS);
    expect(buildInitialIntentDoc({ ...base, parsed: { ...base.parsed, expiresAtFromApiMs: 2_000_000 } }).expiresAtMs).toBe(2_000_000);
  });

  it("initializes status=awaiting_payment with empty processedEventIds", () => {
    const doc = buildInitialIntentDoc({
      intentDocId: "d1", storeId: "SHT", sessionId: "sess_1",
      amount: 850, amountCentavos: 85000, methodId: "mop_1",
      createdByUid: "uid_1", createdByLocalUserId: null,
      parsed: { paymongoIntentId: "pi_1", qrData: "q", imageUrl: null, expiresAtFromApiMs: null },
      nowMs: 1,
    });
    expect(doc.status).toBe("awaiting_payment");
    expect(doc.processedEventIds).toEqual([]);
    expect(doc.paymongoPaymentId).toBeNull();
  });
});

function baseDoc(): PosPaymentIntentDoc {
  return {
    id: "d1", storeId: "SHT", sessionId: "sess_1", provider: "paymongo_qrph",
    amount: 850, amountCentavos: 85000, paymongoIntentId: "pi_1", paymongoPaymentId: null,
    qrData: "q", imageUrl: null, status: "awaiting_payment", createdAtMs: 1, expiresAtMs: 2,
    processedEventIds: [], methodId: "mop_1", createdByLocalUserId: null, createdByUid: "uid_1",
  };
}
const paidEvent: WebhookEvent = {
  eventId: "evt_1", type: "payment.paid", paymentId: "pay_1", paymentIntentId: "pi_1",
  status: "paid", amountCentavos: 85000, currency: "PHP",
  metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "d1", kind: "pos_session" },
};

describe("applyWebhookToIntentDoc", () => {
  it("marks paid and records the payment id + event id", () => {
    const { changed, next } = applyWebhookToIntentDoc(baseDoc(), paidEvent);
    expect(changed).toBe(true);
    expect(next.status).toBe("paid");
    expect(next.paymongoPaymentId).toBe("pay_1");
    expect(next.processedEventIds).toEqual(["evt_1"]);
  });

  it("is idempotent for a repeated event id", () => {
    const once = applyWebhookToIntentDoc(baseDoc(), paidEvent).next;
    const twice = applyWebhookToIntentDoc(once, paidEvent);
    expect(twice.changed).toBe(false);
  });

  it("does not downgrade a paid doc on a later failed event", () => {
    const paid = applyWebhookToIntentDoc(baseDoc(), paidEvent).next;
    const failed: WebhookEvent = { ...paidEvent, eventId: "evt_2", type: "payment.failed", status: "failed" };
    const res = applyWebhookToIntentDoc(paid, failed);
    expect(res.next.status).toBe("paid");
    expect(res.changed).toBe(false);
  });

  it.each([
    ["another intent", { paymentIntentId: "pi_other" }, "intent_mismatch"],
    ["a different amount", { amountCentavos: 85001 }, "amount_mismatch"],
    ["no amount", { amountCentavos: null }, "amount_missing"],
    ["another currency", { currency: "USD" }, "currency_mismatch"],
    ["no currency", { currency: null }, "currency_missing"],
  ] as const)("B24: a paid event for %s does not settle and is not marked processed", (_l, over, reason) => {
    const res = applyWebhookToIntentDoc(baseDoc(), { ...paidEvent, ...over });
    expect(res.changed).toBe(false);
    expect(res.rejected).toBe(reason);
    expect(res.next.status).toBe("awaiting_payment");
    expect(res.next.processedEventIds).toEqual([]);
  });

  it("accepts a lower-case currency code", () => {
    expect(applyWebhookToIntentDoc(baseDoc(), { ...paidEvent, currency: "php" }).next.status).toBe("paid");
  });

  it("maps a failed event on an awaiting doc to failed", () => {
    const failed: WebhookEvent = { ...paidEvent, eventId: "evt_3", type: "payment.failed", status: "failed" };
    expect(applyWebhookToIntentDoc(baseDoc(), failed).next.status).toBe("failed");
  });
});
