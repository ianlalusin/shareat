// Shared per-line money math for item-level reporting (daily analytics,
// external sold-items, refund valuation). Pure — no Firestore imports.
//
// Mirrors calculateBillTotals (src/lib/tax.ts) line handling:
//   - per-unit gross = unitPrice + modifiersTotal. POS lines store the base
//     price in unitPrice and the modifier sum in modifiersTotal; online orders
//     bake modifiers into unitPrice and set modifiersTotal=0, so adding it here
//     counts modifiers exactly once in both cases.
//   - line discounts (lineAdjustments, else the legacy discount* fields) are
//     taken on that gross per-unit price, oldest adjustment first.

export interface LineLite {
  id?: string | null;
  type?: string | null;
  unitPrice?: number | null;
  modifiersTotal?: number | null;
  qtyOrdered?: number | null;
  freeQty?: number | null;
  voidedQty?: number | null;
  lineAdjustments?: Record<string, any> | null;
  discountType?: string | null;
  discountValue?: number | null;
  discountQty?: number | null;
  /** Set on refund-receipt lines: item-revenue amount reversed (positive). */
  refundSalesAmount?: number | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** qtyOrdered − voidedQty − freeQty (may be ≤ 0). */
export function lineBillableQty(line: LineLite): number {
  return num(line.qtyOrdered) - num(line.voidedQty) - num(line.freeQty);
}

/** Per-unit price actually billed: base unit price + modifiers, counted once. */
export function lineUnitGross(line: LineLite): number {
  return Math.max(0, num(line.unitPrice)) + num(line.modifiersTotal);
}

export interface LineAmounts {
  billableQty: number;
  unitGross: number;
  gross: number;
  discount: number;
  net: number;
}

/** Gross, line-discount and net (gross − line discounts) for one line. */
export function lineItemAmounts(line: LineLite): LineAmounts {
  const billableQty = lineBillableQty(line);
  const unitGross = lineUnitGross(line);
  if (billableQty <= 0) return { billableQty: 0, unitGross, gross: 0, discount: 0, net: 0 };

  const gross = billableQty * unitGross;
  let discount = 0;
  const adjs = Object.values(line.lineAdjustments ?? {})
    .filter((a: any) => a && a.kind === "discount")
    .sort((a: any, b: any) => num(a.createdAtClientMs) - num(b.createdAtClientMs));

  if (adjs.length > 0) {
    let remaining = billableQty;
    for (const a of adjs as any[]) {
      if (remaining <= 0) break;
      const q = Math.min(num(a.qty), remaining);
      if (q <= 0) continue;
      discount += a.type === "percent"
        ? q * unitGross * (num(a.value) / 100)
        : Math.min(unitGross, num(a.value)) * q;
      remaining -= q;
    }
  } else if (num(line.discountValue) > 0 && num(line.discountQty) > 0) {
    const q = Math.min(num(line.discountQty), billableQty);
    discount = line.discountType === "percent"
      ? q * unitGross * (num(line.discountValue) / 100)
      : Math.min(unitGross, num(line.discountValue)) * q;
  }
  discount = Math.min(discount, gross);
  return { billableQty, unitGross, gross, discount, net: gross - discount };
}

/**
 * Item-revenue (net of line discounts) a line contributes, UNSIGNED. A refund
 * line carries the exact amount it reverses in `refundSalesAmount` (allocated
 * from the original line at refund time); older refund lines fall back to the
 * computed net of their cloned quantities.
 */
export function lineSalesAmount(line: LineLite): number {
  if (line.refundSalesAmount != null && Number.isFinite(Number(line.refundSalesAmount))) {
    return Number(line.refundSalesAmount);
  }
  return lineItemAmounts(line).net;
}
