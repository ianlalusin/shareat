
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Clock, History, Loader2 } from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { Badge } from "../ui/badge";
import type { KitchenTicket } from "@/lib/types";

export type ReadyItem = KitchenTicket & {
  docId: string;
};


interface ReadyToServeProps {
    items: ReadyItem[];
    onMarkServed: (item: ReadyItem) => void;
    onViewTimeline: (sessionId: string) => void;
    isServing: Record<string, boolean>;
}

function toJsDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v?.toDate === "function") return v.toDate();
  if (typeof v === "number" || typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'object' && 'seconds' in v && 'nanoseconds' in v) {
    const d = new Date(v.seconds * 1000 + v.nanoseconds / 1000000);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
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
        {items.length === 0 && <p className="text-muted-foreground text-center py-4">No items ready to serve.</p>}
        {items.map(item => {
            const isAlaCarte = item.sessionMode === 'alacarte';
            const displayLocation = isAlaCarte ? item.customerName || 'Ala Carte' : `Table ${item.tableNumber}`;
            return (
          <Card key={item.docId} className="p-0">
             <CardHeader className="flex flex-row items-center justify-between p-3">
                 <div className="flex items-center gap-2">
                    <CardTitle className="text-lg">{displayLocation}</CardTitle>
                    <TimeAgo date={item.preparedAt} />
                 </div>
                 <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onViewTimeline(item.sessionId)}>
                        <History className="h-4 w-4" />
                    </Button>
                    <Button size="sm" onClick={() => onMarkServed(item)} disabled={isServing[item.docId]} className="h-8">
                        {isServing[item.docId] ? <Loader2 className="animate-spin"/> : <Send />}
                    </Button>
                </div>
             </CardHeader>
             <CardContent className="p-3 pt-0">
                 <p className="font-medium text-base">{item.itemName}</p>
                 <p className="text-sm text-muted-foreground">{item.kitchenLocationName}</p>
             </CardContent>
          </Card>
        )})}
      </CardContent>
    </Card>
  );
}
