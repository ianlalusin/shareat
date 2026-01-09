
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
import { getEligibleTicketIds } from "./billable-lines";
import type { OrderItemStatus, Discount, PendingSession, BillableLine, KitchenTicket } from "@/lib/types";

interface BillableItemsProps {
  lines: BillableLine[];
  tickets: Map<string, KitchenTicket>;
  storeId: string;
  session: PendingSession;
  discounts: Discount[];
  onApplyDiscount: (lineId: string, discountType: "fixed" | "percent", discountValue: number, quantity: number) => void;
  onApplyFree: (lineId: string, quantity: number, currentIsFree: boolean) => void;
  onVoidItem: (lineId: string, quantity: number, reason: string, note?: string) => void;
  onUpdateQty: (lineId: string, newQty: number) => void;
  onUpdateUnitPrice: (lineId: string, newPrice: number) => void;
  isLocked?: boolean;
}

function BillableLineRow({ 
    line, 
    onEdit,
    isLocked,
    servedQty,
    pendingQty,
    cancelledQty,
}: { 
    line: BillableLine, 
    onEdit: (line: BillableLine) => void,
    isLocked?: boolean,
    servedQty: number,
    pendingQty: number,
    cancelledQty: number,
}) {
    
    const hasDiscount = (line.discountValue ?? 0) > 0;
    const isPackage = line.type === 'package';
    
    return (
        <div className="flex flex-col border-b last:border-b-0">
            <div className="flex items-center gap-4 py-3 px-4">
                <div className="flex-1">
                    <p className="font-medium">{line.itemName}</p>
                    <div className="text-xs text-muted-foreground">
                        <p>{line.qty} x ₱{line.unitPrice.toFixed(2)} each = ₱{(line.qty * line.unitPrice).toFixed(2)}</p>
                        {(!isPackage && (servedQty > 0 || pendingQty > 0 || cancelledQty > 0)) && (
                            <p>({servedQty} served, {pendingQty} pending, {cancelledQty} cancelled)</p>
                        )}
                         {isPackage && <p>({line.qty} Guests)</p>}
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
    lines, 
    tickets,
    storeId,
    session,
    discounts,
    onApplyDiscount, 
    onApplyFree, 
    onVoidItem,
    onUpdateQty,
    onUpdateUnitPrice,
    isLocked = false 
}: BillableItemsProps) {
  
  const { appUser } = useAuthContext();
  const [editingLine, setEditingLine] = useState<BillableLine | null>(null);

  const activeLines = lines.filter(line => !line.isVoided);
  const voidedLines = lines.filter(line => line.isVoided);
  
  const handleApplyDiscountWrapper = (lineId: string, discountType: "fixed" | "percent", discountValue: number, quantity: number) => {
    onApplyDiscount(lineId, discountType, discountValue, quantity);
  };


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
            <div className="space-y-4">
                {activeLines.map((line) => {
                  const isPackage = line.type === 'package';
                  const title = isPackage ? 'Package' : `Add-ons & Refills - ${line.itemName}`;

                  return (
                    <div key={line.id}>
                      <h3 className="text-sm font-semibold mb-2 px-4 pt-4">{title}</h3>
                      <div className="divide-y border-t">
                          <BillableLineRow 
                            key={line.id}
                            line={line}
                            onEdit={setEditingLine}
                            isLocked={isLocked}
                            servedQty={getEligibleTicketIds(line, tickets, 'served').length}
                            pendingQty={getEligibleTicketIds(line, tickets, 'pending').length}
                            cancelledQty={line.qty - getEligibleTicketIds(line, tickets, 'any').length}
                          />
                      </div>
                    </div>
                  );
                })}

                {voidedLines.length > 0 && (
                     <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="voided-items" className="border-t">
                            <AccordionTrigger className="px-4 text-muted-foreground">
                                Voided Items ({voidedLines.reduce((sum, l) => sum + l.qty, 0)})
                            </AccordionTrigger>
                            <AccordionContent className="px-4">
                                <div className="divide-y">
                                {voidedLines.map(line => (
                                    <div key={line.id} className="py-2">
                                        <div className="flex justify-between">
                                            <p className="font-medium text-muted-foreground line-through">{line.qty}x {line.itemName}</p>
                                            <p className="text-muted-foreground line-through">₱{(line.qty * line.unitPrice).toFixed(2)}</p>
                                        </div>
                                        <p className="text-xs text-destructive">
                                            Voided by {line.voidedByUid?.substring(0, 6)} at {line.voidedAt ? format(toJsDate(line.voidedAt)!, 'p') : ''}
                                        </p>
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
            tickets={tickets}
            discounts={discounts}
            isLocked={isLocked}
            onUpdateQty={onUpdateQty}
            onUpdateUnitPrice={onUpdateUnitPrice}
            onApplyDiscount={handleApplyDiscountWrapper}
            onApplyFree={onApplyFree}
            onVoidItem={onVoidItem}
        />
      )}
    </>
  );
}
