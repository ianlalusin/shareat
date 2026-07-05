import { describe, it, expect } from "vitest";
import {
  pesosToCentavos,
  assertPayableAmount,
  MIN_QRPH_AMOUNT_CENTAVOS,
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
