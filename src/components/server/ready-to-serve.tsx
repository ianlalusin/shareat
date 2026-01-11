
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "../ui/button";
import { Send, Clock, History, Loader2 } from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { Badge } from "../ui/badge";
import type { KitchenTicket } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";
import { computeSessionLabel } from "@/lib/utils/session";


export type ReadyItem = KitchenTicket & {
  docId: string;
};


interface ReadyToServeProps {
    items: ReadyItem[];
    onMarkServed: (item: ReadyItem) => void;
    onViewTimeline: (sessionId: string) => void;
    isServing: Record<string, boolean>;
}

function TimeAgo({ date }: { date: any }) {
    const [displayTime, setDisplayTime] = useState("just now");
    const jsDate = toJsDate(date);

    useEffect(() => {
        if (!jsDate) {
            setDisplayTime("a moment ago");
            return;
        }
        
        const updateDisplay = () => {
            const seconds = Math.floor((new Date().getTime() - jsDate.getTime()) / 1000);
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

export function ReadyToServe({ items, onMarkServed, onViewTimeline, isServing }: ReadyToServeProps) {
    
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
            <CardContent className="max-h-[70vh] overflow-y-auto">
                 {itemsWithLabels.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No items are ready.</p>
                ) : (
                    <div className="grid grid-cols-1 gap-2">
                    {itemsWithLabels.map(item => {
                        const displayLocation = item.sessionLabel;
                        
                        return (
                          <Card key={item.docId} className="p-0 flex flex-col">
                             <CardHeader className="flex-row items-start justify-between p-2 space-y-0">
                                 <div className="space-y-1">
                                    <CardTitle className="text-base">{displayLocation}</CardTitle>
                                    <TimeAgo date={item.preparedAt} />
                                 </div>
                                  <div className="flex items-center">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewTimeline(item.sessionId)}>
                                        <History className="h-4 w-4" />
                                    </Button>
                                    <Button size="icon" className="h-7 w-7" onClick={() => onMarkServed(item)} disabled={isServing[item.docId]}>
                                        {isServing[item.docId] ? <Loader2 className="animate-spin h-4 w-4"/> : <Send className="h-4 w-4"/>}
                                    </Button>
                                </div>
                             </CardHeader>
                             <CardContent className="p-2 pt-0 flex-grow">
                                 <div className="bg-muted/50 p-2 rounded-md h-full">
                                     <p className="font-medium text-sm">{item.itemName}</p>
                                     <p className="text-xs text-muted-foreground">{item.kitchenLocationName}</p>
                                 </div>
                             </CardContent>
                          </Card>
                        )
                    })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
