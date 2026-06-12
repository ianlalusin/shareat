import { describe, it, expect } from "vitest";
import { getContributions, buildDeltaIncrements } from "@/lib/analytics/delta-core";
import type { Receipt } from "@/lib/types";

// A realistic finalized dine-in receipt that exercises several contribution
// sections (payments total/method/mode, discounts, charges).
function finalReceipt(): Receipt {
  return {
    id: "r1",
    receiptId: "r1",
    storeId: "TEST",
    status: "final",
    sessionMode: "package_dinein",
    total: 100,
    createdAtClientMs: new Date(2026, 5, 12, 13, 0, 0).getTime(),
    analytics: {
      v: 2,
      grandTotal: 100,
      mop: { gcash: 60, cash: 40 },
      discountsTotal: 11.2,
      chargesTotal: 0,
    },
    lines: [],
  } as unknown as Receipt;
}

// Mirror the endpoint's void reconstruction: neutralize the voided flag so the
// contribution functions yield the original (pre-void) contribution.
function asOriginal(r: Receipt): Receipt {
  return {
    ...(r as any),
    isVoided: false,
    status: (r as any).status === "voided" ? "final" : (r as any).status,
  } as Receipt;
}

describe("void op — reversal symmetry", () => {
  it("void increments are the exact negative of applying the payment", () => {
    const r = finalReceipt();
    const zero = getContributions(null);

    // Apply: null -> receipt (what op:"payment" does)
    const applyInc = buildDeltaIncrements(zero, getContributions(r));
    // Reverse: receipt -> null (what op:"void" does, on the reconstructed original)
    const reverseInc = buildDeltaIncrements(getContributions(asOriginal(r)), zero);

    const keys = new Set([...Object.keys(applyInc), ...Object.keys(reverseInc)]);
    expect(keys.size).toBeGreaterThan(0);
    for (const k of keys) {
      expect(reverseInc[k] ?? 0).toBe(-(applyInc[k] ?? 0));
    }
    // Spot-check a few concrete fields.
    expect(applyInc["payments.totalGross"]).toBe(100);
    expect(reverseInc["payments.totalGross"]).toBe(-100);
    expect(applyInc["payments.byMethod.gcash"]).toBe(60);
    expect(reverseInc["payments.byMethod.gcash"]).toBe(-60);
    expect(reverseInc["payments.txCount"]).toBe(-1);
  });
});

describe("void op — contribution reconstruction", () => {
  it("a voided receipt contributes zero (why the endpoint must neutralize the flag)", () => {
    const voided = { ...(finalReceipt() as any), status: "voided" } as Receipt;
    const c = getContributions(voided);
    expect(c.payment.dayId).toBe("");
    expect(c.payment.totalGross).toBe(0);
    expect(c.payment.txCount).toBe(0);
  });

  it("neutralizing the voided flag restores the original contribution", () => {
    const original = finalReceipt();
    const voided = { ...(original as any), status: "voided" } as Receipt;

    const restored = getContributions(asOriginal(voided));
    const expected = getContributions(original);

    expect(restored.payment.totalGross).toBe(expected.payment.totalGross);
    expect(restored.payment.txCount).toBe(expected.payment.txCount);
    expect(restored.payment.byMethod).toEqual(expected.payment.byMethod);
    expect(restored.payment.dayId).toBe(expected.payment.dayId);
  });
});

describe("edit op — old->new (both non-null) delta", () => {
  it("raising total 100->150 and shifting the method mix nets the difference, txCount unchanged", () => {
    const oldR = finalReceipt(); // total 100, gcash 60 / cash 40
    const newR = {
      ...(oldR as any),
      total: 150,
      analytics: { v: 2, grandTotal: 150, mop: { gcash: 90, cash: 60 }, discountsTotal: 11.2, chargesTotal: 0 },
    } as unknown as Receipt;

    const inc = buildDeltaIncrements(getContributions(oldR), getContributions(newR));
    expect(inc["payments.totalGross"]).toBe(50); // 150 - 100
    expect("payments.txCount" in inc).toBe(false); // edit doesn't add a tx
    expect(inc["payments.byMethod.gcash"]).toBe(30); // 90 - 60
    expect(inc["payments.byMethod.cash"]).toBe(20); // 60 - 40
  });
});

describe("refund op — payment-shape", () => {
  it("a refund receipt applies a negative gross with one tx (same shape as payment)", () => {
    const refund = {
      id: "rf1",
      receiptId: "rf1",
      storeId: "TEST",
      status: "final",
      isRefund: true,
      sessionMode: "package_dinein",
      total: -50,
      createdAtClientMs: new Date(2026, 5, 12, 14, 0, 0).getTime(),
      analytics: { v: 2, grandTotal: -50, mop: { cash: -50 }, discountsTotal: 0, chargesTotal: 0 },
      lines: [],
    } as unknown as Receipt;

    const inc = buildDeltaIncrements(getContributions(null), getContributions(refund));
    expect(inc["payments.totalGross"]).toBe(-50);
    expect(inc["payments.txCount"]).toBe(1);
    expect(inc["payments.byMethod.cash"]).toBe(-50);
  });
});
