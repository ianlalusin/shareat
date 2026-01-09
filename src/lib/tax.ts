
import type { BillUnit, Charge, Discount, Store } from "@/lib/types";

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
  billUnits: BillUnit[],
  store: Store,
  billDiscount: Discount | null,
  charges: Charge[]
): TaxAndTotals {

  const taxRate = (store.taxRatePct || 0) / 100;
  const isVatInclusive = store.taxType === 'VAT_INCLUSIVE';
  const isVatExclusive = store.taxType === 'VAT_EXCLUSIVE';
  const isNonVat = !isVatInclusive && !isVatExclusive;

  let grossSubtotal = 0;
  let lineDiscountsTotal = 0;
  let vatableSales = 0;
  let vatExemptSales = 0;
  
  const activeUnits = billUnits.filter(unit => !(unit as any).billing?.isVoided && !(unit as any).billing?.isFree);

  activeUnits.forEach(unit => {
    const billing = (unit as any).billing;
    const unitPrice = billing?.unitPrice ?? (unit as any).unitPrice ?? 0;
    
    grossSubtotal += unitPrice;
    
    // Determine the base price for discount and VAT calculation
    const preTaxBase = isVatInclusive ? unitPrice / (1 + taxRate) : unitPrice;

    // Calculate line-item discount
    let lineDiscountAmount = 0;
    if (billing?.discountValue && billing.discountValue > 0) {
      if (billing.discountType === 'percent') {
        lineDiscountAmount = preTaxBase * (billing.discountValue / 100);
      } else { // fixed
        lineDiscountAmount = Math.min(preTaxBase, billing.discountValue);
      }
      lineDiscountsTotal += lineDiscountAmount;
    }
    
    const netLineBase = preTaxBase - lineDiscountAmount;
    
    // Aggregate vatable and VAT-exempt sales
    // For now, assuming all items are vatable unless specified otherwise.
    // This can be expanded later if items can be marked as exempt.
    vatableSales += netLineBase;
  });

  const subtotalAfterLineDiscounts = vatableSales;

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
      // Re-calculate the implied tax from the final net amount
      taxTotal = taxableAmount * (taxRate / (1 + taxRate));
  } else if (isVatExclusive) {
      // Apply tax on top of the final net amount
      taxTotal = taxableAmount * taxRate;
  }
  
  // Calculate charges
  const chargesOnSubtotal = charges
    .filter(c => c.appliesTo === 'subtotal')
    .reduce((sum, charge) => {
        return sum + (charge.type === 'fixed' ? charge.value : taxableAmount * (charge.value / 100));
    }, 0);
  
  const totalBeforeFinalCharges = taxableAmount + (isVatExclusive ? taxTotal : 0) + chargesOnSubtotal;
  
  const chargesOnTotal = charges
    .filter(c => c.appliesTo === 'total')
    .reduce((sum, charge) => {
        return sum + (charge.type === 'fixed' ? charge.value : totalBeforeFinalCharges * (charge.value / 100));
    }, 0);
    
  const chargesTotal = chargesOnSubtotal + chargesOnTotal;
  const grandTotal = totalBeforeFinalCharges + chargesOnTotal;

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
