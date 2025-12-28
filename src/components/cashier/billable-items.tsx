
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, PlusCircle, Gift, Percent, Minus, Plus, Check, Loader2 } from "lucide-react";
import { useState, useMemo } from "react";
import { AddonsLauncherButton } from "./addons-launcher-button";
import { Badge } from "../ui/badge";
import { Timestamp } from "firebase/firestore";
import { GroupedBillableItem } from "@/app/cashier/page";
import { BillableItemActionDialog } from "./billable-item-action-dialog";
import { OrderItemStatus } from "@/app/kitchen/page";
import { cn } from "@/lib/utils";
import { Discount } from "@/app/manager/collections/_components/DiscountsSettings";
import { PendingSession } from "../server/pending-tables";
import { useConfirmDialog } from "../global/confirm-dialog";

export type BillableItem = {
  id: string;
  type: "package" | "addon";
  source: "auto" | "manual" | "kitchenticket";
  addonId?: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  lineDiscountType: "percentage" | "fixed";
  lineDiscountValue: number;
  isFree: boolean;
  status: OrderItemStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdByUid: string;
};

interface BillableItemsProps {
  groupedItems: GroupedBillableItem[];
  storeId: string;
  session: PendingSession;
  discounts: Discount[];
  onUpdateQty: (ticketIds: string[], newQty: number) => void;
  onApplyDiscount: (ticketIds: string[], discountType: "fixed" | "percentage", discountValue: number, quantity: number) => void;
  onApplyFree: (ticketIds: string[], quantity: number, currentIsFree: boolean) => void;
  onStatusUpdate: (ticketId: string, newStatus: 'served' | 'void' | 'cancelled', reason?: string) => Promise<void>;
  isLocked?: boolean;
}

type ActionType = "discount" | "free";

function GroupedBillableItemRow({ 
    group, 
    onUpdateQty,
    onApplyDiscount,
    onApplyFree,
    onStatusUpdate,
    discounts,
    isLocked 
}: { 
    group: GroupedBillableItem, 
    onUpdateQty: (ticketIds: string[], newQty: number) => void,
    onApplyDiscount: (ticketIds: string[], discountType: "fixed" | "percentage", discountValue: number, quantity: number) => void,
    onApplyFree: (ticketIds: string[], quantity: number, currentIsFree: boolean) => void;
    onStatusUpdate: (ticketId: string, newStatus: 'served' | 'void' | 'cancelled', reason?: string) => Promise<void>,
    discounts: Discount[],
    isLocked?: boolean 
}) {
    const [action, setAction] = useState<ActionType | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const { confirm, Dialog } = useConfirmDialog();

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
    
    const handleStatusUpdate = async (newStatus: 'served' | 'void' | 'cancelled') => {
        if (isProcessing) return;

        if (newStatus === 'cancelled' || newStatus === 'void') {
            const confirmed = await confirm({
                title: `Cancel item: ${group.itemName}?`,
                description: 'This action cannot be undone.',
                confirmText: "Yes, cancel item",
                destructive: true,
            });
            if (!confirmed) return;
        }

        setIsProcessing(true);
        try {
            // Apply status update to all tickets in the group
            for (const ticketId of group.ticketIds) {
                 await onStatusUpdate(ticketId, newStatus, 'Voided by cashier');
            }
        } finally {
            setIsProcessing(false);
        }
    };
    
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

    return (
        <>
            <div className="flex flex-col border-b last:border-b-0">
                <div className="flex items-center gap-4 py-3 px-4">
                    <div className="flex-1">
                        <p className="font-medium">{group.totalQty}x {group.itemName}</p>
                        <div className="text-xs text-muted-foreground">
                            <p>₱{group.unitPrice.toFixed(2)} each = ₱{(group.totalQty * group.unitPrice).toFixed(2)}</p>
                            {(group.servedQty > 0 || group.pendingQty > 0) && (
                                <p>({group.servedQty} served, {group.pendingQty} pending)</p>
                            )}
                        </div>
                        <Badge variant={getStatusVariant(group.status)} className="capitalize mt-1">{group.status}</Badge>
                         {group.isFree && <Badge variant="outline" className="ml-1 border-yellow-500 text-yellow-600">Free</Badge>}
                         {group.lineDiscountValue > 0 && <Badge variant="outline" className="ml-1 border-blue-500 text-blue-600">Discounted</Badge>}
                    </div>
                    {!isLocked && !isServed && (
                        <div className="flex items-center gap-2">
                            {canPerformAction && (
                                <>
                                    <Button variant="ghost" size="icon" className="text-green-600 h-8 w-8" onClick={() => handleStatusUpdate('served')} disabled={isProcessing}>
                                        {isProcessing ? <Loader2 className="animate-spin"/> : <Check />}
                                    </Button>
                                    <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => handleStatusUpdate('cancelled')} disabled={isProcessing}>
                                        {isProcessing ? <Loader2 className="animate-spin"/> : <X className="h-4 w-4" />}
                                    </Button>
                                </>
                            )}
                        </div>
                    )}
                    {!isLocked && isServed && (
                        <div className="flex items-center gap-2">
                             <Button variant="outline" size="sm" onClick={() => setAction("discount")} disabled={!canDiscount}>
                                <Percent className="mr-2"/>
                                Discount
                            </Button>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={handleFreeClick}
                                disabled={!canFree && !group.isFree}
                                className={cn(group.isFree && 'bg-yellow-400 text-black hover:bg-yellow-400/90')}
                            >
                                <Gift className="mr-2"/>
                                Free
                            </Button>
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
            {Dialog}
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
    isLocked = false 
}: BillableItemsProps) {
  
  const activeItems = groupedItems.filter(item => item.status !== 'void' && item.status !== 'cancelled');
  const voidedItems = groupedItems.filter(item => item.status === 'void' || item.status === 'cancelled');

  const packageGroups = activeItems.filter(item => item.type === 'package');
  const addonGroups = activeItems.filter(item => item.type === 'addon');

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
                                    discounts={discounts}
                                    isLocked={isLocked}
                                />
                            ))}
                         </div>
                    </div>
                )}

                {addonGroups.length > 0 && (
                     <div>
                        <h3 className="text-sm font-semibold my-2 px-4">Add-ons</h3>
                         <div className="divide-y border-t">
                            {addonGroups.map(group => (
                                <GroupedBillableItemRow 
                                    key={group.key} 
                                    group={group}
                                    onUpdateQty={onUpdateQty}
                                    onApplyDiscount={onApplyDiscount}
                                    onApplyFree={onApplyFree}
                                    onStatusUpdate={onStatusUpdate}
                                    discounts={discounts}
                                    isLocked={isLocked}
                                />
                            ))}
                         </div>
                    </div>
                )}
            </div>
        </CardContent>
      </Card>
    </>
  );
}
