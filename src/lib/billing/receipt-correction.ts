import { calculateBillTotals, type TaxAndTotals } from "@/lib/tax";
import type { Adjustment, Discount, Receipt, SessionBillLine, Store } from "@/lib/types";

/**
 * F10: totals for a receipt correction. The receipt's already-consumed loyalty
 * redemptions are part of its settled total and must stay in every
 * recomputation, or a correction would silently charge the reward back.
 */
export function receiptCorrectionTotals(
  receipt: Pick<Receipt, "loyaltyRedemptions">,
  lines: SessionBillLine[],
  store: Store | null,
  billDiscount: Discount | null,
  customAdjustments: Adjustment[],
): TaxAndTotals {
  const redemptions = Array.isArray(receipt.loyaltyRedemptions) ? receipt.loyaltyRedemptions : [];
  return calculateBillTotals(
    lines,
    store,
    billDiscount,
    customAdjustments,
    redemptions.map((r) => ({ type: r.type, value: r.value })),
  );
}
