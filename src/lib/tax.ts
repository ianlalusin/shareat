
import type { SessionBillLine, Charge, Discount, Store, Adjustment, LineAdjustment } from "@/lib/types";

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

/** Rounds to 2 decimal places using standard half-up rounding. EPSILON avoids floating-point edge cases (e.g., 1.005 -> 1.01). */
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
    console.warn("[Tax] calculateBillTotals called with null store — returning zero totals. This may indicate a loading race.");
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
  let lineChargesTotal = 0;
  let vatableSales = 0;
  let vatExemptSales = 0;
  let taxTotal = 0;

  const activeLines = billLines.filter(line => {
    const qty = line.qtyOrdered - (line.voidedQty || 0);
    if (qty < 0) {
      console.warn(`[Tax] Line "${line.itemName}" has voidedQty (${line.voidedQty}) > qtyOrdered (${line.qtyOrdered}). Skipping.`);
      return false;
    }
    return qty > 0;
  });

  activeLines.forEach(line => {
    const billableQty = line.qtyOrdered - (line.voidedQty || 0) - (line.freeQty || 0);
    if (billableQty <= 0) return;

    const unitPrice = Number.isFinite(Number(line.unitPrice)) ? Math.max(0, Number(line.unitPrice)) : 0;
    
    grossSubtotal += billableQty * unitPrice;
    
    const baseUnitPrice = (isVatInclusive && taxRate > 0) ? (unitPrice / (1 + taxRate)) : unitPrice;
    const adjs = Object.values((line as any).lineAdjustments ?? {}).sort((a: any, b: any) => (a.createdAtClientMs || 0) - (b.createdAtClientMs || 0)) as LineAdjustment[];
    const hasAdjDiscount = adjs.some(a => a.kind === "discount");
    
    let remainingQtyForDiscounts = billableQty;

    for (const adj of adjs) {
        if (adj.kind === "discount") {
            if (remainingQtyForDiscounts <= 0) continue;
            const qtyToApply = Math.min(Number(adj.qty || 0), remainingQtyForDiscounts);
            if (qtyToApply <= 0) continue;

            if (adj.type === "percent") {
                lineDiscountsTotal += (qtyToApply * baseUnitPrice) * (Number(adj.value || 0) / 100);
            } else { // fixed
                lineDiscountsTotal += Math.min(baseUnitPrice, Number(adj.value || 0)) * qtyToApply;
            }
            remainingQtyForDiscounts -= qtyToApply;

        } else if (adj.kind === "charge") {
            const qtyToApply = Math.min(Number(adj.qty || 0), billableQty);
            if (qtyToApply <= 0) continue;

            if (adj.type === "percent") {
                lineChargesTotal += (qtyToApply * baseUnitPrice) * (Number(adj.value || 0) / 100);
            } else { // fixed
                lineChargesTotal += Number(adj.value || 0) * qtyToApply;
            }
        }
    }

    // Legacy fallback:
    if (!hasAdjDiscount && line.discountValue && line.discountValue > 0 && line.discountQty > 0) {
      const discountedQty = Math.min(line.discountQty, billableQty);
      
      if (line.discountType === "percent") {
        lineDiscountsTotal += (discountedQty * baseUnitPrice) * ((line.discountValue ?? 0) / 100);
      } else { // fixed
        lineDiscountsTotal += Math.min(baseUnitPrice, (line.discountValue ?? 0)) * discountedQty;
      }
    }
  });
  
  grossSubtotal = round(grossSubtotal);
  lineDiscountsTotal = round(lineDiscountsTotal);
  lineChargesTotal = round(lineChargesTotal);

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
  
  const chargesTotal = round(customAdjustments.reduce((sum, charge) => sum + charge.amount, 0) + lineChargesTotal);

  // Corrected grand total calculation
  const totalBeforeCharges = isVatExclusive
    ? netSalesAfterAllDiscounts + taxTotal
    : netSalesAfterAllDiscounts;

  const grandTotal = totalBeforeCharges + chargesTotal;

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
