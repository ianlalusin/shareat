
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Edit } from "lucide-react";
import { useState, useMemo } from "react";
import { AddonsLauncherButton } from "./addons-launcher-button";
import { Badge } from "../ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { format } from "date-fns";
import { toJsDate } from "@/lib/utils/date";
import { EditBillableItemDialog } from "./edit-billable-item-dialog";
import { useAuthContext } from "@/context/auth-context";
import { makeVariantKey } from "./billable-lines";
import type { OrderItemStatus, Discount, PendingSession, BillUnit } from "@/lib/types";

// This represents a line item shown in the UI, grouped from multiple units.
export type GroupedBillableLine = {
    key: string;
    type: 'package' | 'addon';
    itemId: string;
    itemName: string;
    unitPrice: number;
    qty: number;
    isFree: boolean;
    discountType?: "fixed" | "percent" | null;
    discountValue?: number;
    isVoided: boolean;
    voidReason?: string;
    voidNote?: string;
    underlyingUnits: BillUnit[];
};


interface BillableItemsProps {
  units: BillUnit[];
  storeId: string;
  session: PendingSession;
  discounts: Discount[];
  onApplyDiscount: (units: BillUnit[], discountType: "fixed" | "percent", discountValue: number) => void;
  onApplyFree: (units: BillUnit[], isFree: boolean) => void;
  onVoidItem: (units: BillUnit[], reason: string, note?: string) => void;
  isLocked?: boolean;
}

function BillableLineRow({ 
    line, 
    onEdit,
    isLocked,
}: { 
    line: GroupedBillableLine, 
    onEdit: (line: GroupedBillableLine) => void,
    isLocked?: boolean,
}) {
    
    const hasDiscount = (line.discountValue ?? 0) > 0;
    
    return (
        <div className="flex flex-col border-b last:border-b-0">
            <div className="flex items-center gap-4 py-3 px-4">
                <div className="flex-1">
                    <p className="font-medium">{line.qty > 1 && `${line.qty}x `}{line.itemName}</p>
                     <div className="text-xs text-muted-foreground">
                        <p>{line.qty} x ₱{line.unitPrice.toFixed(2)} each = ₱{(line.qty * line.unitPrice).toFixed(2)}</p>
                    </div>
                    {hasDiscount && <Badge variant="outline" className="mt-1 border-blue-500 text-blue-600">Discounted</Badge>}
                    {line.isFree && <Badge variant="outline" className="mt-1 border-yellow-500 text-yellow-600">Free</Badge>}
                </div>
                {!isLocked && (
                    <div className="flex items-center gap-2">
                       <Button variant="outline" size="sm" onClick={() => onEdit(line)}>
                            <Edit className="mr-2"/> Edit
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}

export function BillableItems({ 
    units,
    storeId,
    session,
    discounts,
    onApplyDiscount, 
    onApplyFree, 
    onVoidItem,
    isLocked = false 
}: BillableItemsProps) {
  
  const { appUser } = useAuthContext();
  const [editingLine, setEditingLine] = useState<GroupedBillableLine | null>(null);

  const { activeLines, voidedLines } = useMemo(() => {
    const grouped = new Map<string, GroupedBillableLine>();

    units.forEach(unit => {
        const billing = (unit as any).billing;
        const key = makeVariantKey({
            type: unit.unitType,
            itemId: unit.unitType === 'package' ? (unit as any).packageId : billing?.itemId,
            unitPrice: billing?.unitPrice ?? (unit as any).unitPrice ?? 0,
            isFree: billing?.isFree,
            discountType: billing?.discountType,
            discountValue: billing?.discountValue,
            isVoided: billing?.isVoided,
        });

        if (grouped.has(key)) {
            const existing = grouped.get(key)!;
            existing.qty += 1;
            existing.underlyingUnits.push(unit);
        } else {
            grouped.set(key, {
                key,
                type: unit.unitType,
                itemId: unit.unitType === 'package' ? (unit as any).packageId : billing.itemId,
                itemName: unit.unitType === 'package' ? (unit as any).packageName : billing.itemName,
                unitPrice: billing?.unitPrice ?? (unit as any).unitPrice ?? 0,
                qty: 1,
                isFree: billing?.isFree ?? false,
                discountType: billing?.discountType,
                discountValue: billing?.discountValue,
                isVoided: billing?.isVoided ?? false,
                voidReason: billing?.voidReason,
                voidNote: billing?.voidNote,
                underlyingUnits: [unit],
            });
        }
    });

    const allLines = Array.from(grouped.values());
    const active = allLines.filter(line => !line.isVoided);
    const voided = allLines.filter(line => line.isVoided);
    return { activeLines: active, voidedLines: voided };
  }, [units]);

  return (
    <>
      <Card className="flex-1 flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between p-4 border-b sticky top-0 bg-background z-10">
            <CardTitle className="text-lg">Billable Items</CardTitle>
            <AddonsLauncherButton
              storeId={storeId}
              session={session}
              sessionIsLocked={isLocked}
            />
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-y-auto">
            <div className="divide-y">
                {activeLines.map((line) => (
                    <BillableLineRow 
                        key={line.key}
                        line={line}
                        onEdit={setEditingLine}
                        isLocked={isLocked}
                    />
                ))}

                {voidedLines.length > 0 && (
                     <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="voided-items" className="border-t">
                            <AccordionTrigger className="px-4 text-muted-foreground">
                                Voided Items ({voidedLines.reduce((sum, l) => sum + l.qty, 0)})
                            </AccordionTrigger>
                            <AccordionContent className="px-4">
                                <div className="divide-y">
                                {voidedLines.map(line => (
                                    <div key={line.key} className="py-2">
                                        <div className="flex justify-between">
                                            <p className="font-medium text-muted-foreground line-through">{line.qty}x {line.itemName}</p>
                                            <p className="text-muted-foreground line-through">₱{(line.qty * line.unitPrice).toFixed(2)}</p>
                                        </div>
                                        <p className="text-xs text-destructive italic">
                                            Reason: {line.voidReason}{line.voidNote ? ` - ${line.voidNote}` : ''}
                                        </p>
                                    </div>
                                ))}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                     </Accordion>
                )}
            </div>
        </CardContent>
      </Card>
      
      {editingLine && appUser && (
        <EditBillableItemDialog
            isOpen={!!editingLine}
            onClose={() => setEditingLine(null)}
            line={editingLine}
            discounts={discounts}
            isLocked={isLocked}
            onApplyDiscount={onApplyDiscount}
            onApplyFree={onApplyFree}
            onVoidItem={onVoidItem}
        />
      )}
    </>
  );
}
