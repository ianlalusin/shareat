
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
import type { Discount, PendingSession, SessionBillLine } from "@/lib/types";

interface BillableItemsProps {
  lines: SessionBillLine[];
  storeId: string;
  session: PendingSession;
  discounts: Discount[];
  isLocked?: boolean;
  onUpdateLine: (lineId: string, before: Partial<SessionBillLine>, after: Partial<SessionBillLine>) => void;
}

function BillableLineRow({ 
    line, 
    onEdit,
    isLocked,
}: { 
    line: SessionBillLine, 
    onEdit: (line: SessionBillLine) => void,
    isLocked?: boolean,
}) {
    const totalDiscountQty = line.discountQty;
    const totalFreeQty = line.freeQty;

    const netQty = line.qtyOrdered - line.voidedQty;

    return (
        <div className="flex flex-col border-b last:border-b-0">
            <div className="flex items-center gap-4 py-3 px-4">
                <div className="flex-1">
                    <p className="font-medium">{netQty > 1 && `${netQty}x `}{line.itemName}</p>
                     <div className="text-xs text-muted-foreground">
                        <p>{netQty} x ₱{line.unitPrice.toFixed(2)} each = ₱{(netQty * line.unitPrice).toFixed(2)}</p>
                    </div>
                    {totalDiscountQty > 0 && <Badge variant="outline" className="mt-1 border-blue-500 text-blue-600">{totalDiscountQty} discounted</Badge>}
                    {totalFreeQty > 0 && <Badge variant="outline" className="mt-1 border-green-500 text-green-600">{totalFreeQty} free</Badge>}
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
    storeId,
    session,
    discounts,
    isLocked = false,
    onUpdateLine
}: BillableItemsProps) {
  
  const { appUser } = useAuthContext();
  const [editingLine, setEditingLine] = useState<SessionBillLine | null>(null);

  const { activeLines, voidedLines } = useMemo(() => {
    const active = lines.filter(line => (line.qtyOrdered - line.voidedQty) > 0);
    const voided = lines.filter(line => line.voidedQty > 0);
    return { activeLines: active, voidedLines: voided };
  }, [lines]);

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
                        key={line.id}
                        line={line}
                        onEdit={setEditingLine}
                        isLocked={isLocked}
                    />
                ))}

                {voidedLines.length > 0 && (
                     <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="voided-items" className="border-t">
                            <AccordionTrigger className="px-4 text-muted-foreground">
                                Voided Items ({voidedLines.reduce((sum, l) => sum + l.voidedQty, 0)})
                            </AccordionTrigger>
                            <AccordionContent className="px-4">
                                <div className="divide-y">
                                {voidedLines.map(line => (
                                    <div key={`${line.id}-voided`} className="py-2">
                                        <div className="flex justify-between">
                                            <p className="font-medium text-muted-foreground line-through">{line.voidedQty}x {line.itemName}</p>
                                            <p className="text-muted-foreground line-through">₱{(line.voidedQty * line.unitPrice).toFixed(2)}</p>
                                        </div>
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
            onSave={onUpdateLine}
        />
      )}
    </>
  );
}
