
import type { SessionBillLine, Charge, Discount, Store, Adjustment } from "@/lib/types";

export interface TaxAndTotals {
  subtotal: number;
  taxableAmount: number;
  taxTotal: number;
  lineDiscountsTotal: number;
  billDiscountTotal: number;
  totalDiscounts: number;
  chargesTotal: number;
  grandTotal: number;
  vatableSales: number;
  vatExemptSales: number;
}

/**
 * Calculates all billing totals, including tax, based on the store's tax settings.
 * @param billUnits The array of all billable units (package guests and add-on tickets).
 * @param store The store object containing taxType and taxRatePct.
 * @param billDiscount An optional bill-wide discount.
 * @param charges An array of additional charges.
 * @returns A comprehensive object with all calculated totals.
 */
export function calculateBillTotals(
  billLines: SessionBillLine[],
  store: Store,
  billDiscount: Discount | null,
  customAdjustments: Adjustment[]
): TaxAndTotals {

  const taxRate = (store.taxRatePct || 0) / 100;
  const isVatInclusive = store.taxType === 'VAT_INCLUSIVE';
  const isVatExclusive = store.taxType === 'VAT_EXCLUSIVE';
  const isNonVat = !isVatInclusive && !isVatExclusive;

  let grossSubtotal = 0;
  let lineDiscountsTotal = 0;
  let vatableSales = 0;
  let vatExemptSales = 0;
  
  const activeLines = billLines.filter(line => (line.qtyOrdered - line.voidedQty) > 0);

  activeLines.forEach(line => {
    const billableQty = line.qtyOrdered - line.voidedQty;
    const unitPrice = line.unitPrice || 0;
    
    // Add to gross subtotal based on the price user sees
    grossSubtotal += billableQty * unitPrice;
    
    // Determine the base price per unit for discount and VAT calculation
    const preTaxBasePerUnit = isVatInclusive ? unitPrice / (1 + taxRate) : unitPrice;

    // Calculate line-item discounts
    if (line.discountValue && line.discountValue > 0 && line.discountQty > 0) {
      const discountedQty = Math.min(line.discountQty, billableQty);
      if (line.discountType === 'percent') {
        lineDiscountsTotal += (preTaxBasePerUnit * (line.discountValue / 100)) * discountedQty;
      } else { // fixed
        lineDiscountsTotal += Math.min(preTaxBasePerUnit, line.discountValue) * discountedQty;
      }
    }
    
    const freeQty = line.freeQty || 0;
    const netBillableQty = billableQty - freeQty;
    
    // Aggregate vatable and VAT-exempt sales
    // For now, assuming all items are vatable unless specified otherwise.
    vatableSales += netBillableQty * preTaxBasePerUnit;
  });

  const subtotalAfterLineDiscounts = vatableSales - lineDiscountsTotal;

  // Calculate bill-wide discount
  let billDiscountTotal = 0;
  if (billDiscount) {
    if (billDiscount.type === 'percent') {
      billDiscountTotal = subtotalAfterLineDiscounts * (billDiscount.value / 100);
    } else { // fixed
      billDiscountTotal = Math.min(subtotalAfterLineDiscounts, billDiscount.value);
    }
  }

  const taxableAmount = subtotalAfterLineDiscounts - billDiscountTotal;
  
  let taxTotal = 0;
  if (isVatInclusive) {
      taxTotal = taxableAmount * (taxRate / (1 + taxRate));
  } else if (isVatExclusive) {
      taxTotal = taxableAmount * taxRate;
  }
  
  const chargesTotal = customAdjustments.reduce((sum, charge) => sum + charge.amount, 0);
  
  const grandTotal = taxableAmount + (isVatExclusive ? taxTotal : 0) + chargesTotal;

  return {
    subtotal: grossSubtotal,
    taxableAmount,
    taxTotal,
    lineDiscountsTotal,
    billDiscountTotal,
    totalDiscounts: lineDiscountsTotal + billDiscountTotal,
    chargesTotal,
    grandTotal,
    vatableSales: isNonVat ? 0 : taxableAmount,
    vatExemptSales, // Currently always 0
  };
}
