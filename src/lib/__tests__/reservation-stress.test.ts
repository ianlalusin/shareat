/**
 * Property-based stress tests for website set-reservation money math.
 *
 * The existing reservation.test.ts covers worked examples; this file checks
 * the INVARIANTS hold over thousands of seeded-random cases, so a rounding or
 * boundary regression anywhere in the deposit/confirm logic is caught even
 * when no single example would show it.
 *
 * Pure module — no Firestore, no React.
 */

import { describe, it, expect } from "vitest";
import {
  DEPOSIT_METHODS,
  balanceOf,
  isReleaseDue,
  meetsDeposit,
  paidAmount,
  receiptMop,
  validatePayment,
  type ReservationPayment,
} from "@/lib/online-orders/reservation";

// Deterministic PRNG (mulberry32) for reproducible "random" data.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cents = (n: number) => Math.round(n * 100);

function randomPayments(rand: () => number, count: number, maxEach = 5000): ReservationPayment[] {
  const methods = DEPOSIT_METHODS as readonly string[];
  return Array.from({ length: count }, (_, i) => ({
    amount: Math.round(rand() * maxEach * 100) / 100,
    methodLabel: methods[i % methods.length],
    reference: rand() < 0.5 ? "REF" + i : null,
    proofUrl: null,
    atMs: i,
    byUid: "u",
    byName: "Ana",
  }));
}

function randomGrandTotal(rand: () => number, max = 100000): number {
  return Math.round(rand() * max * 100) / 100;
}

describe("money invariants over thousands of random payment sequences", () => {
  it("paidAmount is order-independent and never exceeds the sum", () => {
    const rand = mulberry32(0x1234);
    for (let n = 0; n < 2000; n++) {
      const count = Math.floor(rand() * 30);
      const payments = randomPayments(rand, count);
      const shuffled = [...payments].sort(() => rand() - 0.5);
      expect(paidAmount(shuffled)).toBe(paidAmount(payments));
      const brute = cents(payments.reduce((s, p) => s + p.amount, 0));
      expect(cents(paidAmount(payments))).toBe(brute);
    }
  });

  it("balanceOf stays in [0, total] and paid + balance reconstitutes the total", () => {
    const rand = mulberry32(0x5678);
    for (let n = 0; n < 2000; n++) {
      const total = randomGrandTotal(rand);
      const payments = randomPayments(rand, Math.floor(rand() * 30));
      const paid = paidAmount(payments);
      const balance = balanceOf(total, payments);
      expect(balance).toBeGreaterThanOrEqual(0);
      expect(balance).toBeLessThanOrEqual(total + 0.01);
      if (cents(paid) <= cents(total)) {
        expect(cents(paid + balance)).toBe(cents(total));
      } else {
        expect(balance).toBe(0);
      }
    }
  });

  it("meetsDeposit is exactly 2*paid >= total in centavos", () => {
    const rand = mulberry32(0x9abc);
    for (let n = 0; n < 3000; n++) {
      const total = randomGrandTotal(rand, 20000);
      const payments = randomPayments(rand, Math.floor(rand() * 15), 20000);
      const expected = cents(paidAmount(payments)) * 2 >= cents(total);
      expect(meetsDeposit(total, payments)).toBe(expected);
    }
  });

  it("receiptMop always sums to the grand total (payments never exceed it)", () => {
    const rand = mulberry32(0xdef0);
    for (let n = 0; n < 2000; n++) {
      const payments = randomPayments(rand, Math.floor(rand() * 20), 50000);
      // Real flows can't overpay: validatePayment caps each entry at the
      // balance, so the total is always >= what was received.
      const paid = paidAmount(payments);
      const extra = randomGrandTotal(rand, 10000);
      const total = Math.round((paid + extra) * 100) / 100;
      const mop = receiptMop({ grandTotal: total, payments }, "Cash");
      const sum = Object.values(mop).reduce((a, b) => a + b, 0);
      expect(cents(sum)).toBe(cents(total));
    }
  });

  it("validatePayment accepts exactly the valid inputs", () => {
    const rand = mulberry32(0x1357);
    for (let n = 0; n < 3000; n++) {
      const total = randomGrandTotal(rand, 20000);
      const existing = randomPayments(rand, Math.floor(rand() * 5), 20000);
      const balance = balanceOf(total, existing);
      const amount = Math.round(rand() * 30000 * 100) / 100;
      const r = validatePayment(
        { amount, methodLabel: DEPOSIT_METHODS[0], reference: "REF" },
        total,
        existing,
      );
      if (amount > 0 && cents(amount) <= cents(balance)) {
        expect(r.ok).toBe(true);
        if (r.ok) expect(cents(r.value.amount)).toBe(cents(amount));
      } else {
        expect(r.ok).toBe(false);
      }
    }
  });
});

describe("isReleaseDue boundary", () => {
  const base = { kind: "set_reservation", status: "accepted", releaseAtMs: 1000 };
  it("flips at releaseAtMs == now (inclusive)", () => {
    expect(isReleaseDue(base, 1000)).toBe(true);
    expect(isReleaseDue(base, 1001)).toBe(true);
    expect(isReleaseDue(base, 999)).toBe(false);
    // The function checks typeof releaseAtMs === "number" at runtime, so it
    // must also survive malformed Firestore values; cast to any to exercise that.
    const over: any[] = [
      { kind: "website" },
      { status: "pending" },
      { status: "cancelled" },
      { kitchenReleasedAtMs: 1 },
      { releaseAtMs: null },
      { releaseAtMs: "1000" },
    ];
    for (const o of over) {
      expect(isReleaseDue({ ...base, ...o }, 2000)).toBe(false);
    }
  });
});