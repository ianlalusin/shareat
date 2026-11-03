// Refund valuation — pure, integer-centavo math shared by the refund dialog
// (what the cashier sees) and createRefundReceipt (what is saved), so both
// always show the same number.
//
// A refund is valued from what the customer actually PAID on the original
// receipt, not from shelf price:
//   1. The paid total (sum of analytics.mop, i.e. tenders net of change; else
//      receipt.total) is spread across the original billable lines in
//      proportion to each line's net (unit + modifiers, minus line discounts)
//      using largest-remainder rounding — so bill/loyalty discounts, charges
//      and tax are shared out and the line shares sum to the paid total.
//   2. Refunding k units of a line that already had r units refunded is
//      cum(r + k) − cum(r), where cum(n) = round(lineCents · n / billableQty).
//      Partial refunds therefore always add up to exactly the line's share.
//   3. The refund is capped at what is still unrefunded on the receipt.
//   4. The refund is split back across the original tenders in proportion to
//      what is still unrefunded per tender, so a cash sale refunds cash.

import { lineBillableQty, lineItemAmounts, type LineLite } from "@/lib/analytics/line-amounts";

export interface RefundableReceipt {
  status?: string | null;
  isVoided?: boolean | null;
  isRefund?: boolean | null;
  total?: number | null;
  lines?: (LineLite & { id?: string | null })[] | null;
  analytics?: {
    mop?: Record<string, number> | null;
    discountsTotal?: number | null;
    chargesTotal?: number | null;
    taxAmount?: number | null;
  } | null;
  refundedQtys?: Record<string, number> | null;
  /** Pesos already refunded per tender name (written by createRefundReceipt). */
  refundedMop?: Record<string, number> | null;
  totalRefunded?: number | null;
}

export interface RefundQuoteLine {
  lineId: string;
  qty: number;
  /** Centavos of the original payment this refund line returns. */
  paidCents: number;
  /** Centavos of item revenue (net of line discounts) this line reverses. */
  salesCents: number;
}

export interface RefundQuote {
  lines: RefundQuoteLine[];
  totalCents: number;
  /** Positive centavos refunded per tender name (keys = original analytics.mop keys). */
  mopCents: Record<string, number>;
  discountsCents: number;
  chargesCents: number;
  taxCents: number;
}

const toCents = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** Largest-remainder split of `total` (integer ≥ 0) by non-negative weights. */
export function allocateCents(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0 || sumW <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * Math.max(0, w)) / sumW);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((s, v) => s + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1;
  return out;
}

const cum = (cents: number, n: number, of: number) => (of > 0 ? Math.round((cents * n) / of) : 0);

// Quantities (kg / lit / gal can be fractional) are compared in fixed units of
// 1/QTY_SCALE so that float error (0.3 - 0.1 = 0.19999999999999998) can never make
// a legitimate refund look like it exceeds what is left, nor let one slip past.
export const QTY_SCALE = 1000;
const qtyUnits = (n: unknown): number => Math.round((Number(n) || 0) * QTY_SCALE);
/** Rounds a quantity to the supported precision (3 decimal places). */
export function normalizeQty(n: unknown): number {
  return qtyUnits(n) / QTY_SCALE;
}

/** Centavos actually paid on the receipt (tenders net of change). */
export function receiptPaidCents(r: RefundableReceipt): number {
  const mop = r.analytics?.mop;
  if (mop && Object.keys(mop).length > 0) {
    return Object.values(mop).reduce((s, v) => s + toCents(v), 0);
  }
  return Math.max(0, toCents(r.total));
}

/** Per-line share of the paid total and of item revenue, in centavos. */
export function lineAllocations(r: RefundableReceipt): Map<string, { billableQty: number; paidCents: number; salesCents: number }> {
  const lines = (r.lines ?? []).filter((l) => l && l.id && lineBillableQty(l) > 0);
  const amounts = lines.map((l) => lineItemAmounts(l));
  let weights = amounts.map((a) => Math.max(0, Math.round(a.net * 100)));
  if (weights.every((w) => w === 0)) weights = amounts.map((a) => a.billableQty);
  const paid = allocateCents(receiptPaidCents(r), weights);
  const out = new Map<string, { billableQty: number; paidCents: number; salesCents: number }>();
  lines.forEach((l, i) => {
    out.set(String(l.id), {
      billableQty: amounts[i].billableQty,
      paidCents: paid[i],
      salesCents: Math.max(0, Math.round(amounts[i].net * 100)),
    });
  });
  return out;
}

/** Units of a line still refundable. */
export function remainingRefundableQty(r: RefundableReceipt, line: LineLite & { id?: string | null }): number {
  const done = qtyUnits(r.refundedQtys?.[String(line.id)]);
  return Math.max(0, qtyUnits(lineBillableQty(line)) - done) / QTY_SCALE;
}

/**
 * Prices a refund of `qtys` (lineId → units) against the receipt's CURRENT
 * state. Throws if the receipt is not refundable or a quantity exceeds what is
 * still refundable — createRefundReceipt calls this inside its transaction on
 * the freshly read receipt, which is what makes double refunds impossible.
 */
export function quoteRefund(r: RefundableReceipt, qtys: Record<string, number>): RefundQuote {
  if (!r) throw new Error("Receipt not found.");
  if (r.status === "voided" || r.isVoided === true) throw new Error("Cannot refund a voided receipt.");
  if (r.isRefund === true) throw new Error("Cannot refund a refund receipt.");
  if (r.status && r.status !== "final") throw new Error("Only finalized receipts can be refunded.");

  const alloc = lineAllocations(r);
  const byId = new Map((r.lines ?? []).filter((l) => l?.id).map((l) => [String(l.id), l]));
  const lines: RefundQuoteLine[] = [];
  for (const [lineId, rawQty] of Object.entries(qtys)) {
    const qty = Number(rawQty);
    if (!qty) continue;
    if (!Number.isFinite(qty) || qty < 0) throw new Error("Refund quantities must be positive numbers.");
    const units = qtyUnits(qty);
    if (Math.abs(qty * QTY_SCALE - units) > 1e-6) throw new Error("Refund quantities can have at most 3 decimal places.");
    const line = byId.get(lineId);
    const a = alloc.get(lineId);
    if (!line || !a) throw new Error("Refund line not found on the receipt.");
    const doneUnits = qtyUnits(r.refundedQtys?.[lineId]);
    const billUnits = qtyUnits(a.billableQty);
    if (units > billUnits - doneUnits) {
      throw new Error(`Only ${Math.max(0, billUnits - doneUnits) / QTY_SCALE} unit(s) of this item can still be refunded.`);
    }
    lines.push({
      lineId,
      qty: units / QTY_SCALE,
      paidCents: cum(a.paidCents, doneUnits + units, billUnits) - cum(a.paidCents, doneUnits, billUnits),
      salesCents: cum(a.salesCents, doneUnits + units, billUnits) - cum(a.salesCents, doneUnits, billUnits),
    });
  }
  if (lines.length === 0) throw new Error("Select at least one item to refund.");

  const paidCents = receiptPaidCents(r);
  const alreadyCents = Math.max(0, toCents(r.totalRefunded));
  let totalCents = lines.reduce((s, l) => s + l.paidCents, 0);
  const capCents = Math.max(0, paidCents - alreadyCents);
  if (totalCents > capCents) {
    // Legacy over-refunds (pre-fix, shelf-priced) can leave less than the line
    // shares; never refund more than is left. Trim from the last lines.
    let over = totalCents - capCents;
    for (let i = lines.length - 1; i >= 0 && over > 0; i--) {
      const cut = Math.min(over, lines[i].paidCents);
      lines[i].paidCents -= cut;
      over -= cut;
    }
    totalCents = capCents;
  }

  // Tender split — proportional to what each original tender still holds.
  const mop = r.analytics?.mop ?? {};
  const names = Object.keys(mop);
  const avail = names.map((n) => Math.max(0, toCents(mop[n]) - toCents(r.refundedMop?.[n])));
  const split = allocateCents(Math.min(totalCents, avail.reduce((s, v) => s + v, 0)), avail);
  const mopCents: Record<string, number> = {};
  names.forEach((n, i) => { if (split[i] > 0) mopCents[n] = split[i]; });
  const allocated = split.reduce((s, v) => s + v, 0);
  if (allocated < totalCents) {
    // Receipt without tender detail (legacy). Keep the money visible.
    mopCents["Unallocated"] = (mopCents["Unallocated"] ?? 0) + (totalCents - allocated);
  }

  // Signed settlement breakdown, cumulative so partial refunds sum exactly.
  const share = (origPesos: unknown) => {
    const c = toCents(origPesos);
    return cum(c, alreadyCents + totalCents, paidCents) - cum(c, alreadyCents, paidCents);
  };
  return {
    lines,
    totalCents,
    mopCents,
    discountsCents: share(r.analytics?.discountsTotal),
    chargesCents: share(r.analytics?.chargesTotal),
    taxCents: share(r.analytics?.taxAmount),
  };
}

/** Non-throwing preview for the dialog: refund total in pesos (0 if invalid). */
export function previewRefundTotal(r: RefundableReceipt, qtys: Record<string, number>): number {
  try {
    return quoteRefund(r, qtys).totalCents / 100;
  } catch {
    return 0;
  }
}

/** Preview of a single line's refund value in pesos. */
export function previewLineRefund(r: RefundableReceipt, lineId: string, qty: number): number {
  if (!qty) return 0;
  try {
    return quoteRefund(r, { [lineId]: qty }).totalCents / 100;
  } catch {
    return 0;
  }
}
