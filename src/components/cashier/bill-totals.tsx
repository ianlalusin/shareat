
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import type { BillUnit, Adjustment } from "@/lib/types";
import { makeVariantKey } from "./billable-lines";
import type { TaxAndTotals } from "@/lib/tax";

interface BillTotalsProps {
  totals: TaxAndTotals;
  totalPaid: number;
  onRemoveDiscount: (units: BillUnit[]) => void;
  isLocked?: boolean;
}

export function BillTotals({
  totals,
  totalPaid,
  onRemoveDiscount,
  isLocked,
}: BillTotalsProps) {
    
    const { 
        subtotal, 
        totalDiscounts, 
        chargesTotal, 
        grandTotal, 
        taxTotal,
        vatableSales,
        vatExemptSales,
    } = totals;
    
    const remainingBalance = grandTotal - totalPaid;
    const change = totalPaid > grandTotal ? totalPaid - grandTotal : 0;

  return (
    <div className="p-3 border-t bg-background space-y-2 text-sm">
        <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>₱{subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        
        {totalDiscounts > 0 && (
             <div className="flex justify-between text-red-600">
                <span>Discounts</span>
                <span>- ₱{totalDiscounts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
        )}

        {chargesTotal > 0 && (
             <div className="flex justify-between text-green-600">
                <span>Charges</span>
                <span>+ ₱{chargesTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
        )}

        {taxTotal > 0 && (
            <>
                <Separator className="my-1"/>
                <div className="flex justify-between text-muted-foreground">
                    <span>VATable Sales</span>
                    <span>₱{vatableSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                 <div className="flex justify-between text-muted-foreground">
                    <span>VAT-Exempt Sales</span>
                    <span>₱{vatExemptSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                 <div className="flex justify-between text-muted-foreground">
                    <span>VAT ({((totals as any).taxRate || 0.12) * 100}%)</span>
                    <span>₱{taxTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
