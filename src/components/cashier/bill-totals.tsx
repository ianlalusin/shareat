
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BillableItem } from "./billable-items";
import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Adjustment } from "./bill-adjustments";

interface BillTotalsProps {
  items: BillableItem[];
  subtotal: number;
  lineDiscountsTotal: number;
  billDiscountAmount: number;
  adjustments: Adjustment[];
  grandTotal: number;
  totalPaid: number;
  onRemoveDiscount: (ticketIds: string[]) => void;
}

type GroupedSummaryItem = {
    key: string;
    itemName: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    discountType: 'fixed' | 'percentage';
    discountValue: number;
    ticketIds: string[];
};

export function BillTotals({
  items,
  subtotal,
  lineDiscountsTotal,
  billDiscountAmount,
  adjustments,
  grandTotal,
  totalPaid,
  onRemoveDiscount,
}: BillTotalsProps) {
    
    const billableItems = items.filter(item => !item.isFree);
    
    const groupedSummaryItems = useMemo(() => {
        const groups: Record<string, GroupedSummaryItem> = {};
        
        billableItems.forEach(item => {
            const discountKey = `${item.lineDiscountType}-${item.lineDiscountValue}`;
            const key = `${item.itemName}|${item.unitPrice}|${discountKey}`;

            if (!groups[key]) {
                groups[key] = {
                    key,
                    itemName: item.itemName || "(Unnamed Item)",
                    qty: 0,
                    unitPrice: item.unitPrice,
                    lineTotal: 0,
                    discountType: item.lineDiscountType,
                    discountValue: item.lineDiscountValue,
                    ticketIds: [],
                };
            }
            const itemQty = Math.max(1, Number(item.qty) || 1);
            groups[key].qty += itemQty;
            groups[key].lineTotal += itemQty * item.unitPrice;
            groups[key].ticketIds.push(item.id);
        });

        return Object.values(groups);

    }, [billableItems]);

    const freeItems = useMemo(() => {
        const groups: Record<string, GroupedSummaryItem> = {};
        items.filter(i => i.isFree).forEach(item => {
             const key = `${item.itemName}|${item.unitPrice}`;
            if (!groups[key]) {
                groups[key] = {
                    key,
                    itemName: item.itemName || "(Unnamed Item)",
                    qty: 0,
                    unitPrice: item.unitPrice,
                    lineTotal: 0,
                    discountType: 'fixed',
                    discountValue: 0,
                    ticketIds: [],
                };
            }
            groups[key].qty += item.qty;
        });
        return Object.values(groups);
    }, [items]);

    const remainingBalance = grandTotal - totalPaid;
    const change = totalPaid > grandTotal ? totalPaid - grandTotal : 0;

  return (
    <div className="flex-1 flex flex-col p-4">
        <div className="space-y-1 text-sm pr-4">
            {groupedSummaryItems.map(item => {
                const hasDiscount = item.discountValue > 0;
                let discountAmount = 0;
                if (hasDiscount) {
                    discountAmount = item.discountType === 'percentage'
                        ? item.lineTotal * (item.discountValue / 100)
                        : Math.min(item.discountValue * item.qty, item.lineTotal);
                }

                const displayQty = Math.max(1, item.qty);

                return (
                    <div key={item.key} className="py-1">
                        <div className="flex justify-between items-center">
                            <div>
                                <p>{displayQty > 1 && `${displayQty}x `}{item.itemName}</p>
                                <p className="text-muted-foreground text-xs">{displayQty} x ₱{item.unitPrice.toFixed(2)}</p>
                            </div>
                            <p>₱{item.lineTotal.toFixed(2)}</p>
                        </div>
                        {hasDiscount && (
                            <div className="flex justify-between items-center text-xs text-red-600 pl-4 cursor-pointer" onClick={() => onRemoveDiscount(item.ticketIds)}>
                                <span>Discount ({item.discountType === 'percentage' ? `${item.discountValue}%` : `₱${item.discountValue}`})</span>
                                <div className="flex items-center gap-1">
                                    <span>- ₱{discountAmount.toFixed(2)}</span>
                                    <Trash2 className="h-3 w-3" />
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}
            {freeItems.length > 0 && <Separator className="my-2"/>}
            {freeItems.map(item => (
                <div key={item.key} className="flex justify-between items-center text-muted-foreground">
                    <div>
                        <p>{item.qty > 1 && `${item.qty}x `}{item.itemName}</p>
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
              <span>₱{subtotal.toFixed(2)}</span>
            </div>
            
            {/* --- Discounts Section --- */}
            {(lineDiscountsTotal > 0 || billDiscountAmount > 0) && (
                 <div className="flex justify-between text-red-600">
                    <span>Total Discounts</span>
                    <span>- ₱{(lineDiscountsTotal + billDiscountAmount).toFixed(2)}</span>
                </div>
            )}

            {/* --- Adjustments & Charges --- */}
            {adjustments.map(adj => (
                 <div key={adj.id} className={`flex justify-between ${adj.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <span>{adj.note}</span>
                    <span>{adj.amount >= 0 ? '+' : '-'} ₱{Math.abs(adj.amount).toFixed(2)}</span>
                </div>
            ))}
            
            <Separator className="my-2"/>
            
             <div className="flex justify-between font-bold text-lg pt-1">
              <span>Amount Due</span>
              <span>₱{grandTotal.toFixed(2)}</span>
            </div>
            
             <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Paid</span>
                <span className="font-medium">₱{totalPaid.toFixed(2)}</span>
            </div>
            <div className={`flex justify-between text-sm ${remainingBalance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                <span className="text-muted-foreground">{remainingBalance > 0 ? "Balance" : "Change"}</span>
                <span className="font-medium">₱{(remainingBalance > 0 ? remainingBalance : change).toFixed(2)}</span>
            </div>
        </div>
    </div>
  );
}
