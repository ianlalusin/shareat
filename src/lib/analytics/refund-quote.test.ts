import { describe, it, expect } from "vitest";
import { quoteRefund, allocateCents, previewRefundTotal, remainingRefundableQty } from "@/lib/analytics/refund-quote";
import { getPaymentContribution, getSalesContribution } from "@/lib/analytics/daily";
import { aggregateSoldItems } from "@/lib/analytics/sold-items-core";
import { lineItemAmounts } from "@/lib/analytics/line-amounts";

const MS = 1793224800000;

// One item, shelf 100, paid 80 after a 20% bill discount, all cash.
function discountedSale(extra: Record<string, any> = {}) {
  return {
    id: "orig", receiptId: "orig", status: "final", sessionMode: "alacarte", total: 80,
    createdAtClientMs: MS,
    lines: [{ id: "L1", type: "addon", itemId: "inv1", itemName: "Mock", category: "Food", qtyOrdered: 1, freeQty: 0, voidedQty: 0, unitPrice: 100 }],
    analytics: { v: 2, grandTotal: 80, discountsTotal: 20, chargesTotal: 0, taxAmount: 0, mop: { Cash: 80 } },
    ...extra,
  } as any;
}

describe("quoteRefund — values refunds from what was paid (B11)", () => {
  it("full refund of a discounted 80 sale is exactly 80, not the 100 shelf price", () => {
    const q = quoteRefund(discountedSale(), { L1: 1 });
    expect(q.totalCents).toBe(8000);
    expect(q.mopCents).toEqual({ Cash: 8000 });
    expect(q.discountsCents).toBe(2000);
  });

  it("partial refunds sum exactly to the paid total (centavo rounding)", () => {
    const r = discountedSale({
      total: 100,
      lines: [{ id: "L1", type: "addon", itemName: "X", qtyOrdered: 3, unitPrice: 33.34 }],
      analytics: { v: 2, mop: { Cash: 60, GCash: 40 }, discountsTotal: 0.02, chargesTotal: 0 },
    });
    let refunded = 0, refundedQtys: Record<string, number> = {}, refundedMop: Record<string, number> = {};
    let mopSum: Record<string, number> = {};
    for (let i = 0; i < 3; i++) {
      const q = quoteRefund({ ...r, refundedQtys, refundedMop, totalRefunded: refunded / 100 }, { L1: 1 });
      refunded += q.totalCents;
      refundedQtys = { L1: i + 1 };
      for (const [k, c] of Object.entries(q.mopCents)) {
        mopSum[k] = (mopSum[k] || 0) + c;
        refundedMop = { ...refundedMop, [k]: (mopSum[k]) / 100 };
      }
    }
    expect(refunded).toBe(10000);
    expect(mopSum).toEqual({ Cash: 6000, GCash: 4000 });
    expect(() => quoteRefund({ ...r, refundedQtys, totalRefunded: 100 }, { L1: 1 })).toThrow();
  });

  it("modifier-bearing lines are refunded at unit + modifiers", () => {
    const r = discountedSale({
      total: 120,
      lines: [{ id: "L1", type: "addon", itemName: "M", qtyOrdered: 1, unitPrice: 100, modifiersTotal: 20 }],
      analytics: { v: 2, mop: { Cash: 120 } },
    });
    expect(quoteRefund(r, { L1: 1 }).totalCents).toBe(12000);
  });

  it("rejects voided receipts, refund receipts and over-quantity", () => {
    expect(() => quoteRefund(discountedSale({ status: "voided" }), { L1: 1 })).toThrow(/voided/);
    expect(() => quoteRefund(discountedSale({ isRefund: true }), { L1: 1 })).toThrow(/refund/);
    expect(() => quoteRefund(discountedSale(), { L1: 2 })).toThrow(/can still be refunded/);
    expect(() => quoteRefund(discountedSale({ refundedQtys: { L1: 1 } }), { L1: 1 })).toThrow();
  });

  it("allocateCents is exact", () => {
    expect(allocateCents(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocateCents(0, [1, 2])).toEqual([0, 0]);
  });
});

// Fractional kg / lit / gal quantities (edit-billable-item-dialog allows 0.1 steps).
// Refund quantities must be checked in fixed units, not whole numbers, and the
// repeated-partial-refund running total must not drift on float error.
describe("quoteRefund — fractional quantities", () => {
  // 0.5 kg at 100/kg, paid 50 in cash.
  function halfKilo(extra: Record<string, any> = {}) {
    return discountedSale({
      total: 50,
      lines: [{ id: "L1", type: "addon", itemName: "Rice by kg", qtyOrdered: 0.5, unitPrice: 100 }],
      analytics: { v: 2, mop: { Cash: 50 } },
      ...extra,
    });
  }

  it("fully refunds 0.5 kg for exactly the 50 paid", () => {
    const q = quoteRefund(halfKilo(), { L1: 0.5 });
    expect(q.totalCents).toBe(5000);
    expect(q.lines[0].qty).toBe(0.5);
    expect(q.mopCents).toEqual({ Cash: 5000 });
  });

  it("the dialog preview shows the full amount, not zero", () => {
    expect(previewRefundTotal(halfKilo(), { L1: 0.5 })).toBe(50);
  });

  it("repeated partial refunds of 0.1 + 0.2 + 0.2 sum exactly to the paid amount and cannot exceed the line", () => {
    let receipt = halfKilo();
    let refundedCents = 0;
    for (const qty of [0.1, 0.2, 0.2]) {
      const q = quoteRefund(receipt, { L1: qty });
      refundedCents += q.totalCents;
      // createRefundReceipt adds quantities and rounds to 3 places.
      const done = Math.round(((receipt.refundedQtys?.L1 ?? 0) + qty) * 1000) / 1000;
      receipt = { ...receipt, refundedQtys: { L1: done }, totalRefunded: refundedCents / 100 };
    }
    expect(refundedCents).toBe(5000);
    expect(remainingRefundableQty(receipt, receipt.lines[0])).toBe(0);
    expect(() => quoteRefund(receipt, { L1: 0.1 })).toThrow(/can still be refunded/);
  });

  it("is not tripped by float error in the refunded quantity already stored", () => {
    // 0.1 + 0.2 stored the naive way is 0.30000000000000004; 0.2 is still left of 0.5.
    const r = halfKilo({ refundedQtys: { L1: 0.1 + 0.2 }, totalRefunded: 30 });
    expect(remainingRefundableQty(r, r.lines[0])).toBe(0.2);
    expect(quoteRefund(r, { L1: 0.2 }).totalCents).toBe(2000);
    expect(() => quoteRefund(r, { L1: 0.3 })).toThrow(/can still be refunded/);
  });

  it("allows a fraction of a multi-kilo line and keeps the sum exact", () => {
    const r = discountedSale({
      total: 250,
      lines: [{ id: "L1", type: "addon", itemName: "Rice by kg", qtyOrdered: 2.5, unitPrice: 100 }],
      analytics: { v: 2, mop: { Cash: 250 } },
    });
    expect(quoteRefund(r, { L1: 1.5 }).totalCents).toBe(15000);
  });

  it("whole-number refunds still behave as before", () => {
    const r = discountedSale({
      total: 300,
      lines: [{ id: "L1", type: "addon", itemName: "X", qtyOrdered: 3, unitPrice: 100 }],
      analytics: { v: 2, mop: { Cash: 300 } },
    });
    expect(quoteRefund(r, { L1: 2 }).totalCents).toBe(20000);
  });

  it("rejects negative, non-finite and over-precise quantities", () => {
    expect(() => quoteRefund(halfKilo(), { L1: -0.1 })).toThrow(/positive/);
    expect(() => quoteRefund(halfKilo(), { L1: Infinity })).toThrow(/positive/);
    expect(() => quoteRefund(halfKilo(), { L1: 0.1234 })).toThrow(/3 decimal/);
  });

  it("ignores a zero or empty quantity and still needs at least one item", () => {
    expect(() => quoteRefund(halfKilo(), { L1: 0 })).toThrow(/at least one/i);
  });
});

describe("refund receipts in analytics (B13/B14)", () => {
  // Shape createRefundReceipt writes for a full refund of discountedSale().
  const refund = {
    id: "rf", isRefund: true, status: "final", sessionMode: "alacarte", total: -80, createdAtClientMs: MS,
    lines: [{ id: "L1", type: "addon", itemId: "inv1", itemName: "Mock", category: "Food", qtyOrdered: 1, freeQty: 0, voidedQty: 0, unitPrice: 100, refundPaidAmount: 80, refundSalesAmount: 100 }],
    analytics: { v: 2, grandTotal: -80, totalPaid: -80, discountsTotal: -20, chargesTotal: 0, mop: { Cash: -80 } },
  } as any;

  it("cash refund reduces the cash method", () => {
    const p = getPaymentContribution(refund);
    expect(p.totalGross).toBe(-80);
    expect(p.byMethod).toEqual({ Cash: -80 });
    const sale = getPaymentContribution(discountedSale());
    expect((sale.byMethod.Cash || 0) + (p.byMethod.Cash || 0)).toBe(0);
  });

  it("sale + full refund nets item and category sales to zero", () => {
    const s = getSalesContribution(discountedSale());
    const r = getSalesContribution(refund);
    expect(r.addonSalesByItem.Mock.qty).toBe(-1);
    expect(s.addonSalesByItem.Mock.qty + r.addonSalesByItem.Mock.qty).toBe(0);
    expect(s.addonSalesByItem.Mock.amount + r.addonSalesByItem.Mock.amount).toBe(0);
    expect(s.addonSalesQtyByCategory.Food + r.addonSalesQtyByCategory.Food).toBe(0);
    expect(s.addonSalesAmountByCategory.Food + r.addonSalesAmountByCategory.Food).toBe(0);
    expect(s.salesGrossByMode.walkIn + r.salesGrossByMode.walkIn).toBe(0);
    expect(s.netSalesByMode.walkIn + r.netSalesByMode.walkIn).toBe(0);
  });

  it("legacy refund (no refundSalesAmount) still subtracts", () => {
    const legacy = { ...refund, lines: [{ ...refund.lines[0], refundSalesAmount: undefined }] };
    expect(getSalesContribution(legacy).addonSalesByItem.Mock.amount).toBe(-100);
  });

  it("sold-items nets the refund to nothing too", () => {
    const agg = aggregateSoldItems([discountedSale(), refund]);
    expect(agg.items).toEqual([]);
  });
});

describe("modifier revenue counted exactly once (B15)", () => {
  const posLine = { id: "a", type: "addon", itemId: "inv1", itemName: "Mod", category: "Food", qtyOrdered: 1, unitPrice: 100, modifiersTotal: 20 };
  const onlineLine = { id: "b", type: "addon", itemId: "inv1", itemName: "Mod", category: "Food", qtyOrdered: 1, unitPrice: 120, modifiersTotal: 0 };
  const rec = (line: any) => ({ status: "final", total: 120, createdAtClientMs: MS, sessionMode: "alacarte", lines: [line] }) as any;

  it("POS line (base + modifiersTotal) contributes 120", () => {
    expect(getSalesContribution(rec(posLine)).addonSalesByItem.Mod.amount).toBe(120);
  });
  it("online line (modifiers baked into unitPrice) contributes 120", () => {
    expect(getSalesContribution(rec(onlineLine)).addonSalesByItem.Mod.amount).toBe(120);
  });
  it("sold-items grossAmount uses the same per-unit price", () => {
    expect(aggregateSoldItems([rec(posLine)]).items[0].grossAmount).toBe(120);
    expect(aggregateSoldItems([rec(onlineLine)]).items[0].grossAmount).toBe(120);
  });
  it("line discount is taken on unit + modifiers", () => {
    const l = { ...posLine, lineAdjustments: { d: { kind: "discount", type: "percent", value: 50, qty: 1 } } };
    expect(lineItemAmounts(l).net).toBe(60);
  });
});
