import { describe, it, expect } from "vitest";
import {
  DEPOSIT_METHODS,
  balanceOf,
  isReleaseDue,
  meetsDeposit,
  paidAmount,
  receiptMop,
  reservationBadge,
  reservationRowPaymentText,
  validatePayment,
  type ReservationPayment,
} from "./reservation";

const pay = (amount: number, methodLabel = "GCash"): ReservationPayment => ({
  amount,
  methodLabel,
  reference: "REF1",
  proofUrl: null,
  atMs: 1,
  byUid: "u",
  byName: "Ana",
});

describe("deposit math", () => {
  it("sums payments to 2 decimals", () => {
    expect(paidAmount([pay(0.1), pay(0.2)])).toBe(0.3);
  });
  it("balance never goes below zero", () => {
    expect(balanceOf(1000, [pay(1200)])).toBe(0);
    expect(balanceOf(3333, [pay(1700)])).toBe(1633);
  });
  it("50% of 3333 is 1666.50: exactly that confirms, a centavo less does not", () => {
    expect(meetsDeposit(3333, [pay(1666.5)])).toBe(true);
    expect(meetsDeposit(3333, [pay(1666.49)])).toBe(false);
  });
});

describe("validatePayment", () => {
  const input = { amount: 1000, methodLabel: "GCash", reference: "ABC123" };
  it("accepts a valid deposit and normalises fields", () => {
    const r = validatePayment(input, 3333, []);
    expect(r).toEqual({
      ok: true,
      value: { amount: 1000, methodLabel: "GCash", reference: "ABC123", proofUrl: null },
    });
  });
  it("rejects zero, negative and non-numeric amounts", () => {
    for (const amount of [0, -5, "abc", NaN]) {
      expect(validatePayment({ ...input, amount }, 3333, []).ok).toBe(false);
    }
  });
  it("rejects an amount above the balance", () => {
    const r = validatePayment({ ...input, amount: 2000 }, 3333, [pay(1700)]);
    expect(r).toEqual({ ok: false, error: "Amount exceeds the balance (₱1,633.00)." });
  });
  it("rejects a method that is not GCash, Maya or Bank transfer", () => {
    expect(DEPOSIT_METHODS).toEqual(["GCash", "Maya", "Bank transfer"]);
    expect(validatePayment({ ...input, methodLabel: "Cash" }, 3333, []).ok).toBe(false);
  });
  it("needs a reference or a screenshot", () => {
    const r = validatePayment({ amount: 1000, methodLabel: "GCash" }, 3333, []);
    expect(r).toEqual({ ok: false, error: "Add a reference number or a screenshot." });
    expect(validatePayment({ amount: 1000, methodLabel: "GCash", proofUrl: "https://x/y.jpg" }, 3333, []).ok).toBe(true);
  });
});

describe("isReleaseDue", () => {
  const base = { kind: "set_reservation", status: "accepted", releaseAtMs: 1000 };
  it("is due only for an accepted, unreleased reservation whose time has come", () => {
    expect(isReleaseDue(base, 1000)).toBe(true);
    expect(isReleaseDue(base, 999)).toBe(false);
    expect(isReleaseDue({ ...base, status: "pending" }, 2000)).toBe(false);
    expect(isReleaseDue({ ...base, status: "cancelled" }, 2000)).toBe(false);
    expect(isReleaseDue({ ...base, kitchenReleasedAtMs: 5 }, 2000)).toBe(false);
    expect(isReleaseDue({ ...base, kind: "website" }, 2000)).toBe(false);
  });
});

describe("receiptMop", () => {
  it("lists each payment by label and the rest under the completion label; sums to the total", () => {
    const mop = receiptMop({ grandTotal: 3333, payments: [pay(1700), pay(100, "Maya")] }, "Cash");
    expect(mop).toEqual({ GCash: 1700, Maya: 100, Cash: 1533 });
    expect(Object.values(mop).reduce((a, b) => a + b, 0)).toBe(3333);
  });
  it("merges two payments with the same label", () => {
    expect(receiptMop({ grandTotal: 1000, payments: [pay(300), pay(200)] }, "Cash")).toEqual({ GCash: 500, Cash: 500 });
  });
  it("fully paid has no completion row", () => {
    expect(receiptMop({ grandTotal: 1000, payments: [pay(1000)] }, "Cash")).toEqual({ GCash: 1000 });
  });
});

describe("reservationBadge", () => {
  const order = (over: any) => ({ kind: "set_reservation", status: "pending", grandTotal: 3333, payments: [], releaseAtMs: 10_000, ...over });
  it("pending, unpaid, past release time is red", () => {
    expect(reservationBadge(order({}), 20_000)).toEqual({ label: "Unpaid, due", tone: "red" });
  });
  it("pending, unpaid, before release time is gray", () => {
    expect(reservationBadge(order({}), 5_000)).toEqual({ label: "Unpaid", tone: "gray" });
  });
  it("a deposit under 50% is amber before the release time and red once it is past", () => {
    expect(reservationBadge(order({ payments: [pay(1000)] }), 5_000)).toEqual({ label: "Deposit below 50%", tone: "amber" });
    expect(reservationBadge(order({ payments: [pay(500)] }), 20_000)).toEqual({ label: "Deposit below 50%, due", tone: "red" });
  });
  it("50% or more but not full is amber Partial", () => {
    expect(reservationBadge(order({ status: "accepted", payments: [pay(2000)] }), 5_000)).toEqual({ label: "Partial ₱2,000.00 of ₱3,333.00", tone: "amber" });
  });
  it("fully paid is green", () => {
    expect(reservationBadge(order({ status: "accepted", payments: [pay(3333)] }), 5_000)).toEqual({ label: "Paid", tone: "green" });
  });
});

describe("reservationRowPaymentText", () => {
  it("says payment is arranged by phone until something is received, then shows what was received", () => {
    expect(reservationRowPaymentText({ grandTotal: 3333, payments: [] })).toBe("Payment arranged by phone");
    expect(reservationRowPaymentText({ grandTotal: 3333, payments: [pay(1700)] })).toBe("Received ₱1,700.00 of ₱3,333.00");
    expect(reservationRowPaymentText({ grandTotal: 3333, payments: [pay(3333)] })).toBe("Paid in full");
  });
});
