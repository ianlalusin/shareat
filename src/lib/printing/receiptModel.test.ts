import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildReceiptModel, tenderedByMethod } from "./receiptModel";
import { formatReceiptText } from "./receiptFormatter";
import { buildNativeReceiptJob } from "./receiptJob";
import { ReceiptView } from "@/components/receipt/receipt-view";
import type { ReceiptData, ReceiptSettings } from "@/lib/types";

const settings = {
  businessName: "Shop", branchName: "", address: "", contact: "",
  showCashierName: false, showTableOrCustomer: false, showItemNotes: true,
  showDiscountBreakdown: true, showChargeBreakdown: false, paperWidth: "80mm",
  autoPrintAfterPayment: false, fontSize: 12, fontFamily: "",
} as ReceiptSettings;

const line = (o: Record<string, any>) => ({
  id: o.id, itemName: o.itemName, type: "item", qtyOrdered: 1, voidedQty: 0, freeQty: 0,
  unitPrice: 0, modifiersTotal: 0, discountQty: 0, ...o,
}) as any;

function receipt(lines: any[], analytics: Record<string, any>, extra: Record<string, any> = {}): ReceiptData {
  return {
    session: { sessionMode: "alacarte" } as any,
    lines, payments: [], settings, receiptNumber: "R-1", analytics, ...extra,
  } as ReceiptData;
}

/** Sum of the right-hand amounts on native item rows (between header and first rule after it). */
function nativeItemRowSum(text: string): number {
  const rows = text.split("\n");
  const start = rows.findIndex(r => r.startsWith("Qty")) + 1;
  const end = rows.findIndex((r, i) => i >= start && /^-+$/.test(r));
  return rows.slice(start, end)
    .filter(r => /^\d/.test(r))
    .reduce((s, r) => s + Number(r.trim().split(/\s+/).pop()!.replace(/,/g, "")), 0);
}

const modifierReceipt = receipt(
  [
    line({ id: "a", itemName: "Burger", qtyOrdered: 2, unitPrice: 100, modifiersTotal: 20, modifiersText: "Extra cheese" }),
    // Online-order line: modifiers baked into unitPrice, modifiersTotal 0.
    line({ id: "b", itemName: "Online Fries", unitPrice: 75, modifiersTotal: 0, modifiersText: "Large (+15)" }),
    // 3 served, 1 free: only 2 billed.
    line({ id: "c", itemName: "Iced Tea", qtyOrdered: 3, freeQty: 1, unitPrice: 50 }),
    // 10% legacy discount on 1 unit.
    line({ id: "d", itemName: "Pasta", unitPrice: 200, modifiersTotal: 0, discountType: "percent", discountValue: 10, discountQty: 1 }),
  ],
  { subtotal: 615, discountsTotal: 20, grandTotal: 595, totalPaid: 600, change: 5, mop: { cash: 600 } },
);

describe("shared receipt model (F16)", () => {
  it("native item rows include modifiers once and sum to the printed subtotal, same as browser", () => {
    const native = formatReceiptText(modifierReceipt, 80);
    const model = buildReceiptModel(modifierReceipt);
    const browserSum = model.rows.reduce((s, r) => s + r.amount, 0);

    expect(model.rows.map(r => r.amount)).toEqual([240, 75, 100, 200]);
    expect(browserSum).toBe(615);
    expect(nativeItemRowSum(native)).toBe(615);
    expect(native).toMatch(/SUBTOTAL\s+615\.00/);
    expect(native.split("Extra cheese").length - 1).toBe(1);
    expect(native.split("Large (+15)").length - 1).toBe(1);
    expect(native).toContain("Free (1x)");
    expect(native).toMatch(/Discount \(1x\)\s+-20\.00/);
    expect(native).toMatch(/DISCOUNTS\s+\(-20\.00\)/);
    expect(native).toMatch(/TOTAL\s+PHP 595\.00/);

    const html = renderToStaticMarkup(createElement(ReceiptView, { data: modifierReceipt }));
    for (const amt of ["240.00", "75.00", "100.00", "200.00", "615.00", "595.00"]) expect(html).toContain(amt);
    expect(html.split("Extra cheese").length - 1).toBe(1);
  });

  it("refund receipts print negative rows that sum to the negative subtotal in both outputs", () => {
    const refund = receipt(
      [line({ id: "a", itemName: "Burger", unitPrice: 100, modifiersTotal: 20, modifiersText: "Extra cheese" })],
      { subtotal: -120, discountsTotal: 0, grandTotal: -120, totalPaid: -120, change: 0, mop: { cash: -120 } },
      { isRefund: true, receiptNumber: "X-9" },
    );
    const native = formatReceiptText(refund, 80);
    expect(native).toContain("REFUND RECEIPT");
    expect(nativeItemRowSum(native)).toBe(-120);
    expect(native).toMatch(/CASH REFUNDED\s+-120\.00/);
    expect(buildReceiptModel(refund).rows[0].amount).toBe(-120);
    const html = renderToStaticMarkup(createElement(ReceiptView, { data: refund }));
    expect(html).toContain("REFUND RECEIPT");
    expect(html).toContain("-120.00");
  });
});

describe("selected paper width (F15)", () => {
  it("passes a 58mm selection to the native job even when the store default is 80mm", () => {
    const job = buildNativeReceiptJob(modifierReceipt, { ...settings, paperWidth: "80mm" }, "store-1", "58mm");
    expect(job.widthMm).toBe(58);
    const widest = Math.max(...job.text.split("\n").map(l => l.length));
    expect(widest).toBeLessThanOrEqual(32);
    expect(nativeItemRowSum(job.text)).toBe(615);
  });

  it("passes an 80mm selection when the store default is 58mm", () => {
    const job = buildNativeReceiptJob(modifierReceipt, { ...settings, paperWidth: "58mm" }, "store-1", "80mm");
    expect(job.widthMm).toBe(80);
  });

  it("falls back to the store default when nothing was selected", () => {
    expect(buildNativeReceiptJob(modifierReceipt, { ...settings, paperWidth: "58mm" }, "s").widthMm).toBe(58);
  });

  it("drives the browser preview width from the selection, not settings", () => {
    const html = renderToStaticMarkup(createElement(ReceiptView, { data: modifierReceipt, paperWidth: "58mm" }));
    expect(html).toContain("receipt-58");
    expect(html).not.toContain("receipt-80");
  });
});

describe("payment lines: one '<method> Paid' line per method, no Total Paid", () => {
  it("puts the change back on cash so the line shows what was handed over", () => {
    // Checkout stores mop net of change: 716 bill, 1,000 cash, 284 change.
    expect(tenderedByMethod({ Cash: 716 }, 1000, 284)).toEqual([{ methodId: "Cash", amount: 1000 }]);
  });

  it("split tender: change goes on the cash line only", () => {
    expect(tenderedByMethod({ GCash: 300, Cash: 416 }, 800, 84)).toEqual([
      { methodId: "GCash", amount: 300 },
      { methodId: "Cash", amount: 500 },
    ]);
  });

  it("leaves older receipts that already stored the handed-over amount alone", () => {
    expect(tenderedByMethod({ cash: 600 }, 600, 5)).toEqual([{ methodId: "cash", amount: 600 }]);
  });

  it("prints 'Cash Paid' and CHANGE without a separate method or Total Paid line", () => {
    const r = receipt(
      [line({ id: "a", itemName: "Pork and Beef", qtyOrdered: 2, unitPrice: 358 })],
      { subtotal: 716, discountsTotal: 0, grandTotal: 716, totalPaid: 1000, change: 284, mop: { Cash: 716 } },
    );
    const native = formatReceiptText(r, 80);
    expect(native).toMatch(/CASH PAID\s+1,000\.00/);
    expect(native).toMatch(/CHANGE\s+284\.00/);
    expect(native).not.toMatch(/TOTAL PAID/);
    expect(native).not.toMatch(/^CASH\s+716\.00/m);

    const html = renderToStaticMarkup(createElement(ReceiptView, { data: r }));
    expect(html).toContain("Cash Paid");
    expect(html).not.toContain("Total Paid");
    expect(html).not.toContain(">CASH<");
  });
});
