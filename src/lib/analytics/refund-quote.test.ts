import { describe, it, expect } from "vitest";
import { quoteRefund, allocateCents } from "@/lib/analytics/refund-quote";
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
