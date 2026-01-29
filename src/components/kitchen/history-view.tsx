

"use client";

import { useMemo, useState } from "react";
import type { KitchenTicket } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { ArrowLeft, ArrowRight, Clock, Loader2 } from "lucide-react";
import Link from "next/link";

function formatDuration(ms: number): string {
    if (isNaN(ms) || ms <= 0) return "";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

interface HistoryViewProps {
    items: any[];
    isLoading: boolean;
}

export function HistoryView({ items, isLoading }: HistoryViewProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Order History</CardTitle>
                <CardDescription>Recently completed or cancelled items.</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading && items.length === 0 ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="animate-spin" />
                    </div>
                ) : items.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No items in history yet.</p>
                ) : (
                    <div className="space-y-2">
                        {items.map(item => {
                             const isAlaCarte = item.sessionMode === 'alacarte';
                             const displayLocation = item.sessionLabel || (isAlaCarte ? item.customerName || 'Ala Carte' : `Table ${item.tableNumber}`);
                             const hasDuration = item.status === 'served' && item.durationMs && item.durationMs > 0;
                             return (
                            <div key={item.id} className="border rounded-lg p-3 text-sm">
                                <div className="flex justify-between items-start">
                                    <div>
                                      <p className="font-semibold">{displayLocation}</p>
                                      <p className="text-muted-foreground">{item.itemName}</p>
                                    </div>
                                    <Badge 
                                        variant="outline"
                                        className={cn(
                                            "capitalize flex-shrink-0",
                                            item.status === 'served' && "bg-green-100 text-green-800 border-green-300",
                                            item.status === 'cancelled' && "bg-red-100 text-red-800 border-red-300",
                                        )}
                                    >
                                        {item.status}
                                    </Badge>
                                </div>
                                {hasDuration && (
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                                        <Clock size={12} />
                                        <span>Served in {formatDuration(item.durationMs!)}</span>
                                    </div>
                                )}
                            </div>
                        )})}
                    </div>
                )}
            </CardContent>
            <CardFooter>
                <Button asChild variant="outline" className="w-full">
                    <Link href="/logs">View Full History</Link>
                </Button>
            </CardFooter>
        </Card>
    );
}
