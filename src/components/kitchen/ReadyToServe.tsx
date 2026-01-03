

"use client";

import type { KitchenTicket } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "../ui/button";
import { Send, Clock, History, Loader2 } from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { useEffect, useState } from "react";
import { toJsDate } from "@/lib/utils/date";
import { Badge } from "../ui/badge";
import { computeSessionLabel } from "@/lib/utils/session";


interface ReadyToServeProps {
    items: KitchenTicket[];
    onMarkServed: (item: KitchenTicket) => void;
    isServing: Record<string, boolean>;
}

function TimeAgo({ date }: { date: any }) {
    const [displayTime, setDisplayTime] = useState("just now");
    const jsDate = toJsDate(date);

    useEffect(() => {
        if (!jsDate) {
            setDisplayTime("...");
            return;
        }
        
        const updateDisplay = () => {
            const seconds = Math.floor((new Date().getTime() - jsDate.getTime()) / 1000);

            if (seconds < 0) { // Handle client/server time differences
                setDisplayTime("just now");
                return;
            }
            if (seconds < 60) {
                setDisplayTime(`${seconds}s ago`);
            } else {
                const minutes = Math.floor(seconds / 60);
                setDisplayTime(`${minutes}m ago`);
            }
        };

        updateDisplay();
        const interval = setInterval(updateDisplay, 5000); // Update every 5 seconds

        return () => clearInterval(interval);
    }, [jsDate]);

    if (!jsDate) {
        return <p className="text-xs text-amber-600 flex items-center gap-1 mt-1"><Clock size={14}/> ...</p>;
    }

    return (
        <p className="text-xs text-amber-600 flex items-center gap-1"><Clock size={14}/> {displayTime}</p>
    );
}

export function ReadyToServe({ items, onMarkServed, isServing }: ReadyToServeProps) {
    
    const itemsWithLabels = items.map(item => ({
        ...item,
        sessionLabel: computeSessionLabel(item),
    }));

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Ready to Serve</CardTitle>
                    <Badge variant="destructive">{items.length}</Badge>
                </div>
                <CardDescription>Items waiting for server pickup.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">
                 {itemsWithLabels.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No items are ready.</p>
                ) : (
                    itemsWithLabels.map(item => {
                        const displayLocation = item.sessionLabel;
                        
                        return (
                          <Card key={item.id} className="p-0">
                             <CardHeader className="flex flex-row items-center justify-between p-3">
                                 <div className="flex items-center gap-2">
                                    <CardTitle className="text-lg">{displayLocation}</CardTitle>
                                    <TimeAgo date={item.preparedAt} />
                                 </div>
                             </CardHeader>
                             <CardContent className="p-3 pt-0">
                                 <p className="font-medium text-base">{item.itemName}</p>
                                 <p className="text-sm text-muted-foreground">{item.kitchenLocationName}</p>
                             </CardContent>
                          </Card>
                        )
                    })
                )}
            </CardContent>
        </Card>
    );
}
