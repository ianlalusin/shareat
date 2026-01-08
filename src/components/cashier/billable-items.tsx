
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, PlusCircle, Gift, Percent, Minus, Plus, Check, Loader2 } from "lucide-react";
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

interface BillableItemsProps {
  groupedItems: GroupedBillableItem[];
  storeId: string;
  session: PendingSession;
  discounts: Discount[];
  onUpdateQty: (ticketIds: string[], newQty: number) => void;
  onApplyDiscount: (ticketIds: string[], discountType: "fixed" | "percent", discountValue: number, quantity: number) => void;
  onApplyFree: (ticketIds: string[], quantity: number, currentIsFree: boolean) => void;
  onStatusUpdate: (ticketId: string, newStatus: 'served' | 'void' | 'cancelled', reason?: string) => Promise<void>;
  onVoidItem: (ticketId: string, reason: string, note?: string) => void;
  isLocked?: boolean;
}

type ActionType = "discount" | "free";

function GroupedBillableItemRow({ 
    group, 
    onUpdateQty,
    onApplyDiscount,
    onApplyFree,
    onStatusUpdate,
    onVoidItem,
    discounts,
    isLocked 
}: { 
    group: GroupedBillableItem, 
    onUpdateQty: (ticketIds: string[], newQty: number) => void,
    onApplyDiscount: (ticketIds: string[], discountType: "fixed" | "percent", discountValue: number, quantity: number) => void,
    onApplyFree: (ticketIds: string[], quantity: number, currentIsFree: boolean) => void;
    onStatusUpdate: (ticketId: string, newStatus: 'served' | 'void' | 'cancelled', reason?: string) => Promise<void>,
    onVoidItem: (ticketId: string, reason: string, note?: string) => void,
    discounts: Discount[],
    isLocked?: boolean 
}) {
    const [action, setAction] = useState<ActionType | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isVoiding, setIsVoiding] = useState(false);

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
    
    const canPerformAction = (group.status === 'preparing' || group.status === 'ready');
    const canDiscount = group.servedQty > 0 && !group.isFree;
    const canFree = group.servedQty > 0;
    const isServed = group.status === 'served';

    const handleFreeClick = () => {
        if (!canFree && !group.isFree) return;
        
        // If the item is already free, we want to undo it.
        if (group.isFree) {
            onApplyFree(group.ticketIds, group.totalQty, true);
        } else {
            // If there's only one served item, apply directly without dialog
            if (group.servedQty === 1) {
                onApplyFree(group.ticketIds, 1, false);
            } else {
                // Otherwise, open the dialog to select quantity.
                setAction("free");
            }
        }
    }

    const handleVoidClick = () => {
      // For now, voiding one item from a group voids the first ticket ID.
      // A more complex implementation could allow selecting which one.
      setIsVoiding(true);
    }

    return (
        <>
            <div className="flex flex-col border-b last:border-b-0">
                <div className="flex items-center gap-4 py-3 px-4">
                    <div className="flex-1">
                        <p className="font-medium">{group.itemName}</p>
                        <div className="text-xs text-muted-foreground">
                            <p>₱{group.unitPrice.toFixed(2)} each = ₱{(group.totalQty * group.unitPrice).toFixed(2)}</p>
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
                         {group.isFree && <Badge variant="outline" className="ml-1 border-yellow-500 text-yellow-600">Free</Badge>}
                         {group.lineDiscountValue > 0 && <Badge variant="outline" className="ml-1 border-blue-500 text-blue-600">Discounted</Badge>}
                    </div>
                    {!isLocked && (
                        <div className="flex items-center gap-2">
                             {group.totalQty > 1 ? (
                                <div className="flex items-center gap-1">
                                    <Button
                                        size="icon"
                                        variant="outline"
                                        className="h-8 w-8"
                                        disabled={isLocked}
                                        onClick={handleVoidClick}
                                        aria-label="Decrease qty"
                                    >
                                        <Minus className="h-4 w-4" />
                                    </Button>

                                    <div className="min-w-[28px] text-center text-sm font-medium">{group.totalQty}</div>

                                    {/* The "+" button is removed to prevent logic errors. Users should use "Add Item". */}
                                </div>
                            ) : (
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    disabled={isLocked || isProcessing}
                                    className="text-red-500 hover:text-red-600 h-8 w-8"
                                    onClick={handleVoidClick}
                                    aria-label="Void item"
                                >
                                    {isProcessing ? <Loader2 className="animate-spin" /> : <X className="h-4 w-4" />}
                                </Button>
                            )}

                            {isServed && (
                                <>
                                    <Button variant="outline" size="sm" onClick={() => setAction("discount")} disabled={!canDiscount}>
                                        <Percent className="mr-2"/>
                                    </Button>
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={handleFreeClick}
                                        disabled={!canFree && !group.isFree}
                                        className={cn(group.isFree && 'bg-yellow-400 text-black hover:bg-yellow-400/90')}
                                    >
                                        <Gift className="mr-2"/>
                                    </Button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {action && (
                <BillableItemActionDialog
                    isOpen={!!action}
                    onClose={() => setAction(null)}
                    group={group}
                    actionType={action}
                    discounts={discounts}
                    onApplyDiscount={onApplyDiscount}
                    onApplyFree={(ticketIds, qty) => onApplyFree(ticketIds, qty, false)}
                />
            )}
            {isVoiding && (
                <VoidItemDialog
                    isOpen={isVoiding}
                    onClose={() => setIsVoiding(false)}
                    itemName={group.itemName}
                    onConfirm={(reason, note) => {
                        // Apply void to the first available ticket in the group
                        const ticketToVoid = group.ticketIds[0];
                        onVoidItem(ticketToVoid, reason, note);
                    }}
                />
            )}
        </>
    )
}

export function BillableItems({ 
    groupedItems, 
    storeId,
    session,
    discounts,
    onUpdateQty, 
    onApplyDiscount, 
    onApplyFree, 
    onStatusUpdate, 
    onVoidItem,
    isLocked = false 
}: BillableItemsProps) {
  
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
                                    onUpdateQty={onUpdateQty}
                                    onApplyDiscount={onApplyDiscount}
                                    onApplyFree={onApplyFree}
                                    onStatusUpdate={onStatusUpdate}
                                    onVoidItem={onVoidItem}
                                    discounts={discounts}
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
                                    onUpdateQty={onUpdateQty}
                                    onApplyDiscount={onApplyDiscount}
                                    onApplyFree={onApplyFree}
                                    onStatusUpdate={onStatusUpdate}
                                    onVoidItem={onVoidItem}
                                    discounts={discounts}
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
    </>
  );
}
