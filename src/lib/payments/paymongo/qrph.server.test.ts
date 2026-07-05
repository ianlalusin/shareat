import { describe, it, expect, vi } from "vitest";
import { createQrPaymentViaApi, mapIntentStatusToDocStatus } from "@/lib/payments/paymongo/qrph.server";

describe("createQrPaymentViaApi", () => {
  it("creates intent, then method, then attaches, and returns parsed QR", async () => {
    const calls: string[] = [];
    const postJson = vi.fn(async (path: string) => {
      calls.push(path);
      if (path === "/v1/payment_intents") return { data: { id: "pi_1", attributes: {} } };
      if (path === "/v1/payment_methods") return { data: { id: "pm_1", attributes: {} } };
      if (path === "/v1/payment_intents/pi_1/attach") {
        return {
          data: {
            id: "pi_1",
            attributes: {
              next_action: { code: { data: "00020101...", image_url: "https://x/y.png", expires_at: 1751690400 } },
            },
          },
        };
      }
      throw new Error("unexpected path " + path);
    });

    const parsed = await createQrPaymentViaApi(
      { postJson },
      {
        amountCentavos: 85000,
        description: "SHT sess_1",
        metadata: { storeId: "SHT", sessionId: "sess_1", intentDocId: "d1", kind: "pos_session" },
        billing: { name: "Shareat SHT" },
      },
    );

    expect(calls).toEqual([
      "/v1/payment_intents",
      "/v1/payment_methods",
      "/v1/payment_intents/pi_1/attach",
    ]);
    expect(parsed.paymongoIntentId).toBe("pi_1");
    expect(parsed.qrData).toBe("00020101...");
    expect(parsed.expiresAtFromApiMs).toBe(1751690400000);
  });
});

describe("mapIntentStatusToDocStatus", () => {
  it("maps succeeded to paid", () => {
    expect(mapIntentStatusToDocStatus("succeeded")).toBe("paid");
  });
  it("maps in-flight statuses to awaiting_payment", () => {
    expect(mapIntentStatusToDocStatus("awaiting_next_action")).toBe("awaiting_payment");
    expect(mapIntentStatusToDocStatus("processing")).toBe("awaiting_payment");
  });
  it("returns null for unknown statuses", () => {
    expect(mapIntentStatusToDocStatus("weird")).toBeNull();
  });
});
