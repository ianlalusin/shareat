import { describe, it, expect } from "vitest";
import { buildInitialIntentDoc, TEN_MINUTES_MS } from "@/lib/payments/paymongo/bridge.server";

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
