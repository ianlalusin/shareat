
"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle, XCircle, Info } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfirmDialog } from "../global/confirm-dialog";
import { Timestamp } from "firebase/firestore";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { KitchenTicket } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";
import { formatKitchenQty } from "@/lib/uom";

interface KdsItemCardProps {
    ticket: KitchenTicket;
    onUpdateStatus: (ticketId: string, sessionId: string, newStatus: "ready" | "cancelled", reason?: string) => void;
}

function TimeLapse({ startTime }: { startTime: Timestamp | Date | string | null | undefined }) {
    const [now, setNow] = useState(() => new Date());

    const jsDate = useMemo(() => toJsDate(startTime), [startTime]);

    useEffect(() => {
        const timer = setInterval(() => {
            setNow(new Date());
        }, 1000); // Tick every second for live updates
        return () => clearInterval(timer);
    }, []);

    if (!jsDate || !Number.isFinite(jsDate.getTime())) {
        return (
            <div className={cn("flex items-center gap-1.5 text-sm text-amber-600")}>
                <Clock size={14} />
                <span>just now</span>
            </div>
        );
    }
    
    const totalSeconds = Math.floor((now.getTime() - jsDate.getTime()) / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);

    let elapsed = "...";
    if (totalSeconds < 0) {
        elapsed = "0s ago";
    } else if (totalSeconds < 60) {
        elapsed = `${totalSeconds}s ago`;
    } else if (totalMinutes < 60) {
        elapsed = `${totalMinutes}m ago`;
    } else {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const paddedMinutes = minutes < 10 ? `0${minutes}` : minutes;
        elapsed = `${hours}h ${paddedMinutes}m ago`;
    }

    return (
        <div className={cn("flex items-center gap-1.5 text-sm", totalMinutes >= 10 ? "text-destructive font-semibold" : "text-amber-600")}>
            <Clock size={14} />
            <span>{elapsed}</span>
        </div>
    );
}

const CANCELLATION_REASONS = [
    "Out of stock",
    "Customer request",
    "Incorrect order",
];

export function KdsItemCard({ ticket, onUpdateStatus }: KdsItemCardProps) {
    const { confirm, Dialog } = useConfirmDialog();

    const handleCancel = async (reason: string) => {
        if (!reason) return;
        
        const confirmed = await confirm({
            title: `Cancel Item: ${ticket.itemName}?`,
            description: `Reason: ${reason}. This cannot be undone.`,
            confirmText: "Yes, Cancel Item",
            destructive: true,
        });

        if (confirmed) {
            onUpdateStatus(ticket.id, ticket.sessionId, "cancelled", reason);
        }
    };

    const isPackage = ticket.type === 'package';
    const isAlaCarte = ticket.sessionMode === 'alacarte';
    
    const identifier = ticket.sessionLabel 
        ?? (isAlaCarte ? (ticket.customerName || "Ala Carte") : `Table ${ticket.tableNumber}`);
        
    const qtyLabel = formatKitchenQty(ticket.qty, ticket.uom);

    return (
        <>
            <Card className={cn("flex flex-col", ticket.status === 'ready' && 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800')}>
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                         <CardTitle className="text-xl">{ticket.itemName} {qtyLabel}</CardTitle>
                         {ticket.status === 'ready' ? (
                            <Badge variant="default" className="bg-green-600 whitespace-nowrap"><CheckCircle className="mr-1" />Ready</Badge>
                        ) : (
                            <Badge variant="outline" className="capitalize">{ticket.status}</Badge>
                        )}
                    </div>
                     <CardDescription className="flex items-center justify-between">
                        <span>{identifier} {isPackage && `(${ticket.guestCount} guests)`}</span>
                        <TimeLapse startTime={ticket.createdAt} />
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex-grow space-y-2">
                    {ticket.initialFlavorNames && ticket.initialFlavorNames.length > 0 && (
                        <div className="text-sm">
                            <p className="font-semibold">Flavors:</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {ticket.initialFlavorNames.map(name => <Badge key={name} variant="secondary">{name}</Badge>)}
                            </div>
                        </div>
                    )}
                    {ticket.notes && (
                         <div className="text-sm p-2 bg-yellow-50 border border-yellow-200 rounded-md dark:bg-yellow-900/20 dark:border-yellow-800">
                            <p className="font-semibold flex items-center gap-1"><Info size={14}/> Notes:</p>
                            <p className="text-muted-foreground pl-2">{ticket.notes}</p>
                        </div>
                    )}
                </CardContent>
                <CardFooter className="flex justify-end gap-2">
                     {ticket.status === 'preparing' && (
                        <>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="destructive" size="sm">
                                        <XCircle className="mr-2" /> Cancel
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    {CANCELLATION_REASONS.map(reason => (
                                        <DropdownMenuItem key={reason} onSelect={() => handleCancel(reason)}>
                                            {reason}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <Button size="sm" onClick={() => onUpdateStatus(ticket.id, ticket.sessionId, 'ready')}>
                               <CheckCircle className="mr-2" /> Mark as Ready
                            </Button>
                        </>
                    )}
                </CardFooter>
            </Card>
            {Dialog}
        </>
    );
}
