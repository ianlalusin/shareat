
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import type { BillUnit, Adjustment } from "@/lib/types";
import { makeVariantKey } from "./billable-lines";

interface BillTotalsProps {
  units: BillUnit[];
  subtotal: number;
  lineDiscountsTotal: number;
  billDiscountAmount: number;
  adjustments: Adjustment[];
  grandTotal: number;
  totalPaid: number;
  onRemoveDiscount: (units: BillUnit[]) => void;
  isLocked?: boolean;
}

export function BillTotals({
  units,
  subtotal,
  lineDiscountsTotal,
  billDiscountAmount,
  adjustments,
  grandTotal,
  totalPaid,
  onRemoveDiscount,
  isLocked,
}: BillTotalsProps) {
    
    const billableLines = useMemo(() => {
        const grouped = new Map<string, { qty: number; unitPrice: number; total: number; isFree: boolean; discountType?: 'fixed' | 'percent'; discountValue?: number; underlyingUnits: BillUnit[] }>();
        const freeItems = new Map<string, { qty: number }>();

        units.forEach(unit => {
            const billing = (unit as any).billing;
            if (!billing || billing.isVoided) return;

            if (billing.isFree) {
                 const key = unit.unitType === 'package' ? (unit as any).packageName : billing.itemName;
                 const existing = freeItems.get(key);
                 if (existing) existing.qty += 1;
                 else freeItems.set(key, { qty: 1 });
                 return;
            }

            const key = makeVariantKey({
                type: unit.unitType,
                itemId: unit.unitType === 'package' ? (unit as any).packageId : billing.itemId,
                unitPrice: billing.unitPrice ?? (unit as any).unitPrice ?? 0,
                isFree: false,
                discountType: billing.discountType,
                discountValue: billing.discountValue,
            });

            if (grouped.has(key)) {
                const existing = grouped.get(key)!;
                existing.qty += 1;
                existing.total += billing.unitPrice ?? (unit as any).unitPrice ?? 0;
                existing.underlyingUnits.push(unit);
            } else {
                grouped.set(key, {
                    qty: 1,
                    unitPrice: billing.unitPrice ?? (unit as any).unitPrice ?? 0,
                    total: billing.unitPrice ?? (unit as any).unitPrice ?? 0,
                    isFree: false,
                    discountType: billing.discountType,
                    discountValue: billing.discountValue,
                    underlyingUnits: [unit],
                });
            }
        });

        return {
            billable: Array.from(grouped.values()),
            free: Array.from(freeItems.entries()),
        }

    }, [units]);

    
    const remainingBalance = grandTotal - totalPaid;
    const change = totalPaid > grandTotal ? totalPaid - grandTotal : 0;

  return (
    <div className="flex-1 flex flex-col p-4">
        <div className="space-y-1 text-sm pr-4">
            {billableLines.billable.map((line, index) => {
                const hasDiscount = (line.discountValue ?? 0) > 0;
                let discountAmount = 0;
                if (hasDiscount) {
                    discountAmount = line.discountType === 'percent'
                        ? line.total * (line.discountValue! / 100)
                        : Math.min(line.discountValue! * line.qty, line.total);
                }
                const itemName = line.underlyingUnits[0].unitType === 'package' ? (line.underlyingUnits[0] as any).packageName : (line.underlyingUnits[0] as any).billing.itemName;

                return (
                    <div key={index} className="py-1">
                        <div className="flex justify-between items-center">
                            <div>
                                <p>{line.qty > 1 && `${line.qty}x `}{itemName}</p>
                                <p className="text-muted-foreground text-xs">{line.qty} x ₱{line.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                            <p>₱{line.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        {hasDiscount && (
                            <div className="flex justify-between items-center text-xs text-red-600 pl-4">
                                <span>Discount ({line.discountType === 'percent' ? `${line.discountValue}%` : `₱${line.discountValue}`})</span>
                                <button className="flex items-center gap-1" disabled={isLocked} onClick={() => onRemoveDiscount(line.underlyingUnits)}>
                                    <span>- ₱{discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        )}
                    </div>
                )
            })}
            {billableLines.free.length > 0 && <Separator className="my-2"/>}
            {billableLines.free.map(([name, item]) => (
                <div key={name} className="flex justify-between items-center text-muted-foreground">
                    <div>
                        <p>{item.qty > 1 && `${item.qty}x `}{name}</p>
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
