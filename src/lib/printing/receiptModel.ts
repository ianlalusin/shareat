// One receipt presentation model shared by the browser ReceiptView and the
// native (Bluetooth/ESC-POS) text formatter, so both print the same rows and
// the same totals. Pure — no React, no Firestore.
//
// Line money comes from lineItemAmounts (src/lib/analytics/line-amounts.ts),
// which mirrors calculateBillTotals: per-unit = unitPrice + modifiersTotal
// (counted once; online-order lines bake modifiers into unitPrice with
// modifiersTotal 0), free units are not billed, line discounts are taken on
// that gross. Row amounts therefore sum to the persisted analytics.subtotal.
// Totals are the persisted receipt analytics — never recomputed here.

import { lineItemAmounts } from "@/lib/analytics/line-amounts";
import type { ReceiptData, SessionBillLine } from "@/lib/types";

export interface ReceiptRowModel {
  key: string;
  /** Units served (ordered − voided), free units included. */
  qty: number;
  name: string;
  modifiersText: string | null;
  note: string | null;
  /** Signed billed amount (negative on refund receipts). */
  amount: number;
  /** Signed line-discount amount shown under the row (≤ 0 on a sale). */
  discount: number;
  discountQty: number;
  freeQty: number;
}

export interface ReceiptModel {
  isRefund: boolean;
  rows: ReceiptRowModel[];
  subtotal: number;
  /** Signed effect of discounts on the total (negative on a sale). */
  discountsEffect: number;
  /** Signed effect of charges on the total (positive on a sale). */
  chargesEffect: number;
  taxAmount: number;
  vatableSales: number;
  vatExemptSales: number;
  grandTotal: number;
  totalPaid: number;
  change: number;
  /** What each method actually handed over ("Cash Paid 1,000"), change included. */
  tenders: { methodId: string; amount: number }[];
  freeItems: { name: string; qty: number }[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function isRefundReceipt(data: Pick<ReceiptData, "receiptNumber"> & Record<string, any>): boolean {
  return !!(data.receiptNumber?.startsWith("RF-") || data.isRefund);
}

export function buildReceiptModel(data: ReceiptData): ReceiptModel {
  const isRefund = isRefundReceipt(data as any);
  const sign = isRefund ? -1 : 1;
  const a = (data.analytics || {}) as Record<string, any>;

  const activeLines = (data.lines || [])
    .filter((l) => num(l.qtyOrdered) - num(l.voidedQty) > 0)
    // Pin the package/bundle line to the top (dine-in); stable for the rest.
    .sort((x, y) => (x.type === "package" ? 0 : 1) - (y.type === "package" ? 0 : 1));

  const rows: ReceiptRowModel[] = activeLines.map((line: SessionBillLine, i) => {
    const amounts = lineItemAmounts(line as any);
    const anyLine = line as any;
    const adjs = Object.values(anyLine.lineAdjustments ?? {}).filter((x: any) => x && x.kind === "discount") as any[];
    const discountQty = adjs.length > 0
      ? adjs.reduce((s, x) => s + num(x.qty), 0)
      : num(line.discountValue) > 0 ? num(line.discountQty) : 0;
    return {
      key: String(line.id ?? i),
      qty: num(line.qtyOrdered) - num(line.voidedQty),
      name: String(line.itemName ?? ""),
      modifiersText: anyLine.modifiersText ? String(anyLine.modifiersText) : null,
      note: anyLine.note ? String(anyLine.note) : null,
      amount: round2(sign * amounts.gross),
      discount: round2(-sign * amounts.discount),
      discountQty: Math.min(discountQty, amounts.billableQty),
      freeQty: num(line.freeQty),
    };
  });

  const freeMap = new Map<string, number>();
  for (const l of data.lines || []) {
    if (num(l.freeQty) > 0) freeMap.set(l.itemName, (freeMap.get(l.itemName) ?? 0) + num(l.freeQty));
  }

  const grandTotalRaw = num(a.grandTotal);
  const taxAmount = num(a.taxAmount);
  const vatExemptSales = num(a.vatExemptSales);
  const vatableSales = a.vatableSales != null ? num(a.vatableSales) : grandTotalRaw - taxAmount - vatExemptSales;
  const totalPaidRaw = num(a.totalPaid);

  return {
    isRefund,
    rows,
    subtotal: num(a.subtotal),
    discountsEffect: -num(a.discountsTotal),
    chargesEffect: num(a.chargesTotal),
    taxAmount,
    vatableSales,
    vatExemptSales,
    grandTotal: isRefund ? -Math.abs(grandTotalRaw) : grandTotalRaw,
    totalPaid: isRefund ? -Math.abs(totalPaidRaw) : totalPaidRaw,
    change: num(a.change),
    tenders: tenderedByMethod(a.mop, totalPaidRaw, num(a.change)),
    freeItems: Array.from(freeMap.entries()).map(([name, qty]) => ({ name, qty })),
  };
}

/**
 * analytics.mop records what each method put toward the bill: checkout takes
 * the change out of the cash entry. The receipt shows what was handed over,
 * so the change goes back onto the cash entry. Older receipts that already
 * stored the handed-over amount (mop sums to totalPaid) are left as they are.
 */
export function tenderedByMethod(
  mop: Record<string, unknown> | undefined,
  totalPaid: number,
  change: number,
): { methodId: string; amount: number }[] {
  const tenders = Object.entries(mop || {}).map(([methodId, amount]) => ({ methodId, amount: num(amount) }));
  const mopSum = tenders.reduce((s, t) => s + t.amount, 0);
  const changeTakenOut = change > 0 && Math.abs(round2(mopSum + change) - round2(totalPaid)) < 0.015;
  if (changeTakenOut) {
    // "Cash", "Cash on Delivery" — but not "GCash".
    const cash = tenders.find((t) => /(^|[^a-z])cash/i.test(t.methodId)) ?? tenders[0];
    if (cash) cash.amount = round2(cash.amount + change);
  }
  return tenders;
}

/** Money as printed: 1,234.50 / -1,234.50. */
export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
