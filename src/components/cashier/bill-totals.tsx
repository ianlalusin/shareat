
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import type { BillableLine, Adjustment } from "@/lib/types";

interface BillTotalsProps {
  lines: BillableLine[];
  subtotal: number;
  lineDiscountsTotal: number;
  billDiscountAmount: number;
  adjustments: Adjustment[];
  grandTotal: number;
  totalPaid: number;
  onRemoveDiscount: (lineId: string) => void;
  isLocked?: boolean;
}

export function BillTotals({
  lines,
  subtotal,
  lineDiscountsTotal,
  billDiscountAmount,
  adjustments,
  grandTotal,
  totalPaid,
  onRemoveDiscount,
  isLocked,
}: BillTotalsProps) {
    
    const billableLines = lines.filter(line => !line.isFree && !line.isVoided);
    const freeLines = lines.filter(line => line.isFree && !line.isVoided);
    
    const remainingBalance = grandTotal - totalPaid;
    const change = totalPaid > grandTotal ? totalPaid - grandTotal : 0;

  return (
    <div className="flex-1 flex flex-col p-4">
        <div className="space-y-1 text-sm pr-4">
            {billableLines.map(line => {
                const hasDiscount = (line.discountValue ?? 0) > 0;
                let discountAmount = 0;
                if (hasDiscount) {
                    discountAmount = line.discountType === 'percent'
                        ? (line.qty * line.unitPrice) * (line.discountValue! / 100)
                        : Math.min(line.discountValue! * line.qty, line.qty * line.unitPrice);
                }

                return (
                    <div key={line.id} className="py-1">
                        <div className="flex justify-between items-center">
                            <div>
                                <p>{line.qty > 1 && `${line.qty}x `}{line.itemName}</p>
                                <p className="text-muted-foreground text-xs">{line.qty} x ₱{line.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                            <p>₱{(line.qty * line.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        {hasDiscount && (
                            <div className="flex justify-between items-center text-xs text-red-600 pl-4">
                                <span>Discount ({line.discountType === 'percent' ? `${line.discountValue}%` : `₱${line.discountValue}`})</span>
                                <button className="flex items-center gap-1" disabled={isLocked} onClick={() => onRemoveDiscount(line.id)}>
                                    <span>- ₱{discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        )}
                    </div>
                )
            })}
            {freeLines.length > 0 && <Separator className="my-2"/>}
            {freeLines.map(line => (
                <div key={line.id} className="flex justify-between items-center text-muted-foreground">
                    <div>
                        <p>{line.qty > 1 && `${line.qty}x `}{line.itemName}</p>
                        <p className="text-xs">Free</p>
                    </div>
                    <p>₱0.00</p>
                </div>
            ))}
        </div>
        
        <div className="pt-4 mt-auto border-t space-y-2 text-sm">
            {/* --- Subtotal Section --- */}
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>₱{subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            
            {/* --- Discounts Section --- */}
            {(lineDiscountsTotal > 0 || billDiscountAmount > 0) && (
                 <div className="flex justify-between text-red-600">
                    <span>Total Discounts</span>
                    <span>- ₱{(lineDiscountsTotal + billDiscountAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            )}

            {/* --- Adjustments & Charges --- */}
            {adjustments.map(adj => (
                 <div key={adj.id} className={`flex justify-between ${adj.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <span>{adj.note}</span>
                    <span>{adj.amount >= 0 ? '+' : '-'} ₱{Math.abs(adj.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            ))}
            
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
    </div>
  );
}
