
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

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
  store: Store | null,
  billDiscount: Discount | null,
  customAdjustments: Adjustment[]
): TaxAndTotals {

  if (!store) {
    return {
      subtotal: 0, taxableAmount: 0, taxTotal: 0, lineDiscountsTotal: 0,
      billDiscountTotal: 0, totalDiscounts: 0, chargesTotal: 0, grandTotal: 0,
      vatableSales: 0, vatExemptSales: 0
    };
  }

  const taxRate = (store.taxRatePct || 0) / 100;
  const isVatInclusive = store.taxType === 'VAT_INCLUSIVE';
  const isVatExclusive = store.taxType === 'VAT_EXCLUSIVE';

  let grossSubtotal = 0;
  let lineDiscountsTotal = 0;
  let vatableSales = 0;
  let vatExemptSales = 0;
  let taxTotal = 0;

  const activeLines = billLines.filter(line => (line.qtyOrdered - (line.voidedQty || 0)) > 0);

  activeLines.forEach(line => {
    const billableQty = line.qtyOrdered - (line.voidedQty || 0) - (line.freeQty || 0);
    const unitPrice = Number.isFinite(Number(line.unitPrice)) ? Number(line.unitPrice) : 0;
    
    grossSubtotal += billableQty * unitPrice;
    
    if (line.discountValue && line.discountValue > 0 && line.discountQty > 0) {
      const discountedQty = Math.min(line.discountQty, billableQty);
      
      const discountBaseUnit = isVatInclusive && taxRate > 0
        ? (unitPrice / (1 + taxRate))
        : unitPrice;

      if (line.discountType === "percent") {
        lineDiscountsTotal += (discountedQty * discountBaseUnit) * ((line.discountValue ?? 0) / 100);
      } else { // fixed
        lineDiscountsTotal += Math.min(discountBaseUnit, (line.discountValue ?? 0)) * discountedQty;
      }
    }
  });
  
  grossSubtotal = round(grossSubtotal);
  lineDiscountsTotal = round(lineDiscountsTotal);

  let billDiscountTotal = 0;
  if (billDiscount) {
    const subtotalForBillDiscount = grossSubtotal - lineDiscountsTotal;
    
    const discountBaseTotal = isVatInclusive && taxRate > 0
      ? (subtotalForBillDiscount / (1 + taxRate))
      : subtotalForBillDiscount;
      
    if (billDiscount.type === 'percent') {
      billDiscountTotal = discountBaseTotal * (billDiscount.value / 100);
    } else { // fixed
      billDiscountTotal = Math.min(discountBaseTotal, billDiscount.value);
    }
  }
  
  billDiscountTotal = round(billDiscountTotal);

  const totalDiscounts = lineDiscountsTotal + billDiscountTotal;
  const netSalesAfterAllDiscounts = grossSubtotal - totalDiscounts;


  if (isVatInclusive) {
      vatableSales = netSalesAfterAllDiscounts / (1 + taxRate);
      taxTotal = netSalesAfterAllDiscounts - vatableSales;
  } else if (isVatExclusive) {
      vatableSales = netSalesAfterAllDiscounts;
      taxTotal = vatableSales * taxRate;
  } else { // NON_VAT
      vatableSales = netSalesAfterAllDiscounts;
      taxTotal = 0;
  }
  
  const chargesTotal = round(customAdjustments.reduce((sum, charge) => sum + charge.amount, 0));

  const grandTotal = netSalesAfterAllDiscounts + taxTotal + chargesTotal;

  return {
    subtotal: grossSubtotal,
    taxableAmount: round(vatableSales), 
    taxTotal: round(taxTotal),
    lineDiscountsTotal: lineDiscountsTotal,
    billDiscountTotal: billDiscountTotal,
    totalDiscounts: round(totalDiscounts),
    chargesTotal,
    grandTotal: round(grandTotal),
    vatableSales: round(vatableSales),
    vatExemptSales: round(vatExemptSales),
  };
}
