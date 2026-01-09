
import type { SessionBillLine, Charge, Discount, Store, Adjustment } from "@/lib/types";

export interface TaxAndTotals {
  subtotal: number;
  taxableAmount: number; // The amount on which tax is calculated (net of discounts)
  taxTotal: number;
  lineDiscountsTotal: number;
  billDiscountTotal: number;
  totalDiscounts: number;
  chargesTotal: number;
  grandTotal: number; // The final, gross amount due by the customer
  vatableSales: number;
  vatExemptSales: number;
}

/**
 * Calculates all billing totals, including tax, based on the store's tax settings.
 * @param billLines The array of all billable line items.
 * @param store The store object containing taxType and taxRatePct.
 * @param billDiscount An optional bill-wide discount.
 * @param customAdjustments An array of additional charges or fixed adjustments.
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

  let grossSubtotal = 0;
  let lineDiscountsTotal = 0;
  let vatableSales = 0;
  let vatExemptSales = 0;
  let taxTotal = 0;

  const activeLines = billLines.filter(line => (line.qtyOrdered - line.voidedQty) > 0);

  activeLines.forEach(line => {
    const billableQty = line.qtyOrdered - line.voidedQty - (line.freeQty || 0);
    const unitPrice = line.unitPrice || 0;
    
    grossSubtotal += billableQty * unitPrice;
    
    if (line.discountValue && line.discountValue > 0 && line.discountQty > 0) {
      const discountedQty = Math.min(line.discountQty, billableQty);
      if (line.discountType === 'percent') {
        lineDiscountsTotal += (discountedQty * unitPrice) * (line.discountValue / 100);
      } else { // fixed
        lineDiscountsTotal += Math.min(unitPrice, line.discountValue) * discountedQty;
      }
    }
  });

  const grossSalesBeforeDiscounts = billLines.reduce((sum, line) => {
      const billableQty = line.qtyOrdered - line.voidedQty - (line.freeQty || 0);
      return sum + (billableQty * line.unitPrice);
  }, 0);

  if (isVatInclusive) {
      vatableSales = grossSalesBeforeDiscounts / (1 + taxRate);
      taxTotal = grossSalesBeforeDiscounts - vatableSales;
  } else if (isVatExclusive) {
      vatableSales = grossSalesBeforeDiscounts;
      taxTotal = vatableSales * taxRate;
  } else { // NON_VAT
      vatableSales = grossSalesBeforeDiscounts;
      taxTotal = 0;
  }

  let billDiscountTotal = 0;
  if (billDiscount) {
    // Bill-wide discount is applied on the gross subtotal after line discounts
    const subtotalAfterLineDiscounts = grossSubtotal - lineDiscountsTotal;
    if (billDiscount.type === 'percent') {
      billDiscountTotal = subtotalAfterLineDiscounts * (billDiscount.value / 100);
    } else { // fixed
      billDiscountTotal = Math.min(subtotalAfterLineDiscounts, billDiscount.value);
    }
  }
  
  const chargesTotal = customAdjustments.reduce((sum, charge) => sum + charge.amount, 0);

  const grandTotal = grossSubtotal - lineDiscountsTotal - billDiscountTotal + chargesTotal;

  return {
    subtotal: grossSubtotal,
    taxableAmount: vatableSales, // For display consistency, taxableAmount is the base for tax
    taxTotal,
    lineDiscountsTotal,
    billDiscountTotal,
    totalDiscounts: lineDiscountsTotal + billDiscountTotal,
    chargesTotal,
    grandTotal,
    vatableSales,
    vatExemptSales,
  };
}
