
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
  let vatableSalesBase = 0; // Net-of-tax sales
  let vatExemptSales = 0;

  const activeLines = billLines.filter(line => (line.qtyOrdered - line.voidedQty) > 0);

  activeLines.forEach(line => {
    const billableQty = line.qtyOrdered - line.voidedQty;
    const unitPrice = line.unitPrice || 0;
    
    grossSubtotal += billableQty * unitPrice;
    
    const preTaxBasePerUnit = isVatInclusive ? unitPrice / (1 + taxRate) : unitPrice;

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
    
    vatableSalesBase += netBillableQty * preTaxBasePerUnit;
  });

  const subtotalAfterLineDiscounts = vatableSalesBase - lineDiscountsTotal;

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

  if (isVatExclusive) {
    // taxableAmount is net; VAT is added on top
    taxTotal = taxableAmount * taxRate;
  } else if (isVatInclusive) {
    // taxableAmount is net-of-tax base; VAT is computed from the base
    taxTotal = taxableAmount * taxRate;
  }

  const chargesTotal = customAdjustments.reduce((sum, charge) => sum + charge.amount, 0);

  // GrandTotal must be the amount the customer pays (gross).
  // - VAT_EXCLUSIVE: net + VAT + charges
  // - VAT_INCLUSIVE: (net + VAT) + charges = net*(1+rate) + charges
  // - NON_VAT: net + charges
  const grandTotal =
    isVatExclusive ? (taxableAmount + taxTotal + chargesTotal)
    : isVatInclusive ? (taxableAmount * (1 + taxRate) + chargesTotal)
    : (taxableAmount + chargesTotal);

  return {
    subtotal: grossSubtotal,          // this is your gross before discounts/free adjustments
    taxableAmount,                    // net-of-tax AFTER discounts (base)
    taxTotal,                         // VAT computed from base
    lineDiscountsTotal,
    billDiscountTotal,
    totalDiscounts: lineDiscountsTotal + billDiscountTotal,
    chargesTotal,
    grandTotal,                       // gross amount due (includes VAT if inclusive)
    vatableSales: isVatInclusive ? taxableAmount : taxableAmount, // net sales base
    vatExemptSales,
  };
}
