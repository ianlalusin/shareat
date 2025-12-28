

"use client";

import { KitchenTicket } from "@/app/kitchen/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "../ui/button";
import { Send, Clock } from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { useEffect, useState } from "react";
import { format } from "date-fns";

interface ReadyToServeProps {
    items: KitchenTicket[];
    onMarkServed: (ticketId: string, sessionId: string, newStatus: "served") => void;
}


function CreationTime({ startTime }: { startTime: Timestamp }) {
    const timeString = format(startTime.toDate(), "HH:mm");

    return (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock size={14} />
            <span>{timeString}</span>
        </div>
    );
}

export function ReadyToServe({ items, onMarkServed }: ReadyToServeProps) {
    
    return (
        <Card>
            <CardHeader>
                <CardTitle>Ready</CardTitle>
                <CardDescription>Items waiting to be served.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[40vh] overflow-y-auto">
                 {items.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No items are ready.</p>
                ) : (
                    items.map(item => {
                        const isAlaCarte = item.sessionMode === 'alacarte';
                        const displayLocation = isAlaCarte ? item.customerName || 'Ala Carte' : `Table ${item.tableNumber}`;
                        
                        return (
                        <Card key={item.id} className="p-0">
                            <CardHeader className="flex flex-row items-center justify-between p-3">
                                <div className="flex items-center gap-2">
                                    <CardTitle className="text-lg">{displayLocation}</CardTitle>
                                    {item.preparedAt && <CreationTime startTime={item.preparedAt} />}
                                </div>
                            </CardHeader>
                            <CardContent className="p-3 pt-0">
                                <p className="font-medium text-base">{item.itemName}</p>
                                <p className="text-sm text-muted-foreground">{item.kitchenLocationName}</p>
                            </CardContent>
                        </Card>
                    )})
                )}
            </CardContent>
        </Card>
    )
}
