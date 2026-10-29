import { describe, it, expect } from "vitest";
import { planGatewayChecks, verifyBridgeTender, verifyReservationTender } from "./gatewayTenders";

const methods = [
  { id: "cash", name: "Cash", type: "cash" },
  { id: "qr", name: "QR Ph", gateway: "paymongo_qrph" },
] as any[];

const bridge = {
  storeId: "s1", sessionId: "sess1", methodId: "qr", status: "paid",
  amount: 250, amountCentavos: 25000, paymongoIntentId: "pi_1", paymongoPaymentId: "pay_1",
};
const qrTender = { id: "t", methodId: "qr", amount: 250, reference: "pay_1", intentDocId: "b1" };
const ctx = { storeId: "s1", sessionId: "sess1" };

describe("planGatewayChecks (audit B03)", () => {
  it("ignores non-gateway tenders and lists bridge checks", () => {
    const checks = planGatewayChecks([{ id: "c", methodId: "cash", amount: 50 }, qrTender], methods);
    expect(checks).toEqual([{ kind: "bridge", payment: qrTender, intentDocId: "b1" }]);
  });
  it.each([NaN, Infinity, -5, 0])("rejects a non-finite / non-positive amount (%s)", (amount) => {
    expect(() => planGatewayChecks([{ id: "c", methodId: "cash", amount }], methods)).toThrow(/positive number/);
  });
  it("rejects a gateway tender carrying only a typed reference (fabricated)", () => {
    expect(() => planGatewayChecks([{ id: "t", methodId: "qr", amount: 250, reference: "pay_forged" }], methods))
      .toThrow(/isn't linked/);
  });
  it("rejects the same bridge used for two tenders", () => {
    expect(() => planGatewayChecks([qrTender, { ...qrTender, id: "t2" }], methods)).toThrow(/listed twice/);
  });
  it("rejects an unsafe bridge id", () => {
    expect(() => planGatewayChecks([{ ...qrTender, intentDocId: "../x" }], methods)).toThrow(/Invalid/);
  });
  it("routes a reservation deposit on the gateway method to a reservation check", () => {
    const p = { id: "r", methodId: "qr", amount: 100, reference: "R1", fromReservationPaymentId: "rp1" };
    expect(planGatewayChecks([p], methods)).toEqual([{ kind: "reservation", payment: p, reservationPaymentId: "rp1" }]);
  });
});

describe("verifyBridgeTender", () => {
  const check = { kind: "bridge" as const, payment: qrTender, intentDocId: "b1" };
  it("accepts a paid bridge for this session, amount and reference", () => {
    expect(verifyBridgeTender(check, bridge, ctx)).toBeNull();
  });
  it("rejects a missing bridge", () => expect(verifyBridgeTender(check, null, ctx)).toMatch(/could not be found/));
  it("rejects an unpaid bridge", () =>
    expect(verifyBridgeTender(check, { ...bridge, status: "awaiting_payment" }, ctx)).toMatch(/not confirmed/));
  it("rejects a bridge from another session (reuse across bills)", () =>
    expect(verifyBridgeTender(check, { ...bridge, sessionId: "other" }, ctx)).toMatch(/another bill/));
  it("rejects a bridge from another store", () =>
    expect(verifyBridgeTender(check, { ...bridge, storeId: "s2" }, ctx)).toMatch(/another store/));
  it("rejects an inflated tender amount (partial payment passed off as full)", () =>
    expect(verifyBridgeTender({ ...check, payment: { ...qrTender, amount: 500 } }, bridge, ctx)).toMatch(/amount/));
  it("rejects a mismatched reference", () =>
    expect(verifyBridgeTender({ ...check, payment: { ...qrTender, reference: "pay_2" } }, bridge, ctx)).toMatch(/reference/));
  it("accepts the intent id as reference when the webhook stored no payment id", () => {
    const b = { ...bridge, paymongoPaymentId: null };
    expect(verifyBridgeTender({ ...check, payment: { ...qrTender, reference: "pi_1" } }, b, ctx)).toBeNull();
  });
});

describe("verifyReservationTender", () => {
  const p = { id: "r", methodId: "qr", amount: 100, reference: "R1", fromReservationPaymentId: "rp1" };
  const check = { kind: "reservation" as const, payment: p, reservationPaymentId: "rp1" };
  const res = { payments: [{ id: "rp1", methodId: "qr", amount: 100, reference: "R1" }], paymentsAppliedToSessionId: null };
  it("accepts a matching live deposit", () => expect(verifyReservationTender(check, res, ctx)).toBeNull());
  it("rejects a deposit already applied to another session", () =>
    expect(verifyReservationTender(check, { ...res, paymentsAppliedToSessionId: "other" }, ctx)).toMatch(/another bill/));
  it("rejects a voided deposit", () =>
    expect(verifyReservationTender(check, { payments: [{ ...res.payments[0], voidedAt: 1 }] }, ctx)).toMatch(/voided/));
  it("rejects a changed amount", () =>
    expect(verifyReservationTender({ ...check, payment: { ...p, amount: 900 } }, res, ctx)).toMatch(/amount/));
  it("rejects when the session has no reservation", () => expect(verifyReservationTender(check, null, ctx)).toMatch(/could not be found/));
});
