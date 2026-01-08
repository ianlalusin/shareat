
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, PlusCircle, Gift, Percent, Minus, Plus, Check, Loader2, Edit } from "lucide-react";
import { useState, useMemo } from "react";
import { AddonsLauncherButton } from "./addons-launcher-button";
import { Badge } from "../ui/badge";
import { Timestamp } from "firebase/firestore";
import { cn } from "@/lib/utils";
import { useConfirmDialog } from "../global/confirm-dialog";
import { BillableItemActionDialog } from "./billable-item-action-dialog";
import type { OrderItemStatus, BillableItem, GroupedBillableItem, Discount, PendingSession } from "@/lib/types";
import { VoidItemDialog } from "./VoidItemDialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { format } from "date-fns";
import { toJsDate } from "@/lib/utils/date";
import { EditBillableItemDialog } from "./edit-billable-item-dialog";

interface BillableItemsProps {
  groupedItems: GroupedBillableItem[];
  storeId: string;
  session: PendingSession;
  discounts: Discount[];
  onUpdateQty: (ticketIds: string[], newQty: number) => void;
  onUpdateUnitPrice: (ticketIds: string[], newPrice: number) => Promise<void>;
  onApplyDiscount: (ticketIds: string[], discountType: "fixed" | "percent", discountValue: number, quantity: number) => void;
  onApplyFree: (ticketIds: string[], quantity: number, currentIsFree: boolean) => void;
  onStatusUpdate: (ticketId: string, newStatus: 'served' | 'void' | 'cancelled', reason?: string) => Promise<void>;
  onVoidItem: (ticketId: string, reason: string, note?: string) => void;
  isLocked?: boolean;
}

type ActionType = "discount" | "free";

function GroupedBillableItemRow({ 
    group, 
    onEdit,
    isLocked 
}: { 
    group: GroupedBillableItem, 
    onEdit: (group: GroupedBillableItem) => void,
    isLocked?: boolean 
}) {

    const getStatusVariant = (status: OrderItemStatus) => {
        switch(status) {
            case 'served': return 'default';
            case 'ready': return 'secondary';
            case 'preparing': return 'outline';
            case 'void':
            case 'cancelled': 
                return 'destructive';
            default: return 'secondary';
        }
    }

    const freeQty = group.freeQty ?? (group.isFree ? group.totalQty : 0);

    return (
        <>
            <div className="flex flex-col border-b last:border-b-0">
                <div className="flex items-center gap-4 py-3 px-4">
                    <div className="flex-1">
                        <p className="font-medium">{group.itemName}</p>
                        <div className="text-xs text-muted-foreground">
                            <p>{group.totalQty} x ₱{group.unitPrice.toFixed(2)} each = ₱{(group.totalQty * group.unitPrice).toFixed(2)}</p>
                            {(group.servedQty > 0 || group.pendingQty > 0) && (
                                <p>({group.servedQty} served, {group.pendingQty} pending)</p>
                            )}
                        </div>
                        <Badge
                          variant={getStatusVariant(group.status ?? "preparing")}
                          className="capitalize mt-1"
                        >
                          {group.status ?? "preparing"}
                        </Badge>
                         {freeQty > 0 && <Badge variant="outline" className="ml-1 border-yellow-500 text-yellow-600">Free ({freeQty})</Badge>}
                         {group.discountQty > 0 && <Badge variant="outline" className="ml-1 border-blue-500 text-blue-600">Discounted ({group.discountQty})</Badge>}
                    </div>
                    {!isLocked && (
                        <div className="flex items-center gap-2">
                           <Button variant="outline" size="sm" onClick={() => onEdit(group)}>
                                <Edit className="mr-2"/> Edit
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

export function BillableItems({ 
    groupedItems, 
    storeId,
    session,
    discounts,
    onUpdateQty, 
    onUpdateUnitPrice,
    onApplyDiscount, 
    onApplyFree, 
    onStatusUpdate, 
    onVoidItem,
    isLocked = false 
}: BillableItemsProps) {
  
  const [editingGroup, setEditingGroup] = useState<GroupedBillableItem | null>(null);

  const activeItems = groupedItems.filter(item => !item.isVoided && item.status !== 'cancelled');
  const voidedItems = groupedItems.filter(item => item.isVoided);

  const packageGroups = activeItems.filter(item => item.type === 'package');
  const addonGroups = activeItems.filter(item => item.type === 'addon' || item.type === 'refill');

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
                {packageGroups.length > 0 && (
                    <div>
                        <h3 className="text-sm font-semibold mb-2 px-4 pt-4">Package</h3>
                         <div className="divide-y border-t">
                            {packageGroups.map(group => (
                                <GroupedBillableItemRow 
                                    key={group.key} 
                                    group={group}
                                    onEdit={setEditingGroup}
                                    isLocked={isLocked}
                                />
                            ))}
                         </div>
                    </div>
                )}

                {addonGroups.length > 0 && (
                     <div>
                        <h3 className="text-sm font-semibold my-2 px-4">Add-ons & Refills</h3>
                         <div className="divide-y border-t">
                            {addonGroups.map(group => (
                                <GroupedBillableItemRow 
                                    key={group.key} 
                                    group={group}
                                    onEdit={setEditingGroup}
                                    isLocked={isLocked}
                                />
                            ))}
                         </div>
                    </div>
                )}

                {voidedItems.length > 0 && (
                     <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="voided-items" className="border-t">
                            <AccordionTrigger className="px-4 text-muted-foreground">
                                Voided Items ({voidedItems.length})
                            </AccordionTrigger>
                            <AccordionContent className="px-4">
                                <div className="divide-y">
                                {voidedItems.map(item => (
                                    <div key={item.key} className="py-2">
                                        <div className="flex justify-between">
                                            <p className="font-medium text-muted-foreground line-through">{item.itemName}</p>
                                            <p className="text-muted-foreground line-through">₱{item.unitPrice.toFixed(2)}</p>
                                        </div>
                                        <p className="text-xs text-destructive">
                                            Voided by {item.voidedByUid?.substring(0, 6)} at {item.voidedAt ? format(toJsDate(item.voidedAt)!, 'p') : ''}
                                        </p>
                                        <p className="text-xs text-destructive italic">
                                            Reason: {item.voidReason}{item.voidNote ? ` - ${item.voidNote}` : ''}
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
      
      {editingGroup && (
        <EditBillableItemDialog
            isOpen={!!editingGroup}
            onClose={() => setEditingGroup(null)}
            group={editingGroup}
            discounts={discounts}
            isLocked={isLocked}
            onUpdateQty={onUpdateQty}
            onUpdateUnitPrice={onUpdateUnitPrice}
            onApplyDiscount={onApplyDiscount}
            onApplyFree={onApplyFree}
            onVoidItem={onVoidItem}
        />
      )}
    </>
  );
}

      