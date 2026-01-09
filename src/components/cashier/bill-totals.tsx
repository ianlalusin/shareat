
"use client";

import { useMemo } from "react";
import { Separator } from "../ui/separator";
import type { SessionBillLine, Discount, Store, Adjustment } from "@/lib/types";
import { calculateBillTotals, type TaxAndTotals } from "@/lib/tax";

interface BillTotalsProps {
  lines: SessionBillLine[];
  store: Store;
  billDiscount: Discount | null;
  customAdjustments: Adjustment[];
  totalPaid: number;
  isLocked?: boolean;
}

export function BillTotals({
  lines,
  store,
  billDiscount,
  customAdjustments,
  totalPaid,
  isLocked,
}: BillTotalsProps) {
    
    const totals = useMemo(() => {
        if (!store) return null; // Add guard for store
        return calculateBillTotals(lines, store, billDiscount, customAdjustments);
    }, [lines, store, billDiscount, customAdjustments]);

    // Add guards for totals being null
    const grandTotal = totals?.grandTotal ?? 0;
    const totalPaidNum = totalPaid ?? 0;
    const remainingBalance = grandTotal - totalPaidNum;
    const change = totalPaidNum > grandTotal ? totalPaidNum - grandTotal : 0;
    
    const activeLines = useMemo(() => lines.filter(line => (line.qtyOrdered - line.voidedQty) > 0), [lines]);

  return (
    <div className="p-3 bg-background space-y-2 text-sm">
        {activeLines.map(line => {
            const billableQty = line.qtyOrdered - line.voidedQty;
            const lineGross = billableQty * line.unitPrice;
            const hasDiscount = line.discountValue && line.discountValue > 0 && line.discountQty > 0;
            const hasFree = line.freeQty > 0;
            const hasVoid = line.voidedQty > 0;
            
            const lineSubRows: React.ReactNode[] = [];
            
            if (hasDiscount) {
                const taxRate = (store.taxRatePct || 0) / 100;
                const isVatInclusive = store.taxType === "VAT_INCLUSIVE";

                const baseUnitPrice = isVatInclusive ? (line.unitPrice / (1 + taxRate)) : line.unitPrice;

                const discountBasePerUnit =
                  line.discountType === "percent"
                    ? baseUnitPrice * ((line.discountValue ?? 0) / 100)
                    : Math.min(baseUnitPrice, (line.discountValue ?? 0));

                const discountDisplayPerUnit = isVatInclusive ? discountBasePerUnit * (1 + taxRate) : discountBasePerUnit;

                const discountAmount = discountDisplayPerUnit * line.discountQty;

                lineSubRows.push(
                    <div key={`${line.id}-disc`} className="flex justify-between pl-4 text-destructive">
                        <span>{` - ${line.discountQty}x Discount`}</span>
                        <span>-₱{discountAmount.toFixed(2)}</span>
                    </div>
                );
            }
             if (hasFree) {
                lineSubRows.push(
                    <div key={`${line.id}-free`} className="flex justify-between pl-4 text-destructive">
                        <span>{` - ${line.freeQty}x Free`}</span>
                        <span>-₱{(line.freeQty * line.unitPrice).toFixed(2)}</span>
                    </div>
                );
            }
             if (hasVoid) {
                lineSubRows.push(
                    <div key={`${line.id}-void`} className="flex justify-between pl-4 text-destructive">
                        <span>{` - ${line.voidedQty}x Voided`}</span>
                        <span>-₱{(line.voidedQty * line.unitPrice).toFixed(2)}</span>
                    </div>
                );
            }

            return (
                <div key={line.id} className="space-y-1">
                    <div className="flex justify-between">
                        <span>{billableQty}x {line.itemName}</span>
                        <span>₱{lineGross.toFixed(2)}</span>
                    </div>
                    {lineSubRows}
                </div>
            )
        })}

        <Separator className="my-2"/>

        <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>₱{(totals?.subtotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        
        {((totals?.totalDiscounts ?? 0) > 0) && (
             <div className="flex justify-between text-red-600">
                <span>Discounts</span>
                <span>- ₱{(totals?.totalDiscounts ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
        )}

        {((totals?.chargesTotal ?? 0) > 0) && (
             <div className="flex justify-between text-green-600">
                <span>Charges</span>
                <span>+ ₱{(totals?.chargesTotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
        )}

        {((totals?.taxTotal ?? 0) > 0) && (
            <>
                <Separator className="my-1"/>
                <div className="flex justify-between text-muted-foreground">
                    <span>VATable Sales</span>
                    <span>₱{(totals?.vatableSales ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                 <div className="flex justify-between text-muted-foreground">
                    <span>VAT-Exempt Sales</span>
                    <span>₱{(totals?.vatExemptSales ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                 <div className="flex justify-between text-muted-foreground">
                    <span>VAT ({((store.taxRatePct || 0))}%)</span>
                    <span>₱{(totals?.taxTotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            </>
        )}
        
        <Separator className="my-2"/>
        
         <div className="flex justify-between font-bold text-lg pt-1">
          <span>Amount Due</span>
          <span>₱{grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        
         <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total Paid</span>
            <span className="font-medium">₱{totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className={`flex justify-between text-sm ${remainingBalance > 0 ? 'text-destructive' : 'text-green-600'}`}>
            <span className="text-muted-foreground">{remainingBalance > 0 ? "Balance" : "Change"}</span>
            <span className="font-medium">₱{(remainingBalance > 0 ? remainingBalance : change).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
    </div>
  );
}
