
"use client";

import { useState, useEffect } from "react";
import { collection, query, where, orderBy, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ActivityLog, PendingSession } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";
import { format } from "date-fns";
import { computeSessionLabel } from "@/lib/utils/session";


function fmtTime(ts?: Timestamp | null) {
  if (!ts) return "";
  const d = toJsDate(ts);
  if (!d) return "";
  return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function actionLabel(a: ActivityLog['action']) {
  switch (a) {
    case "PAYMENT_COMPLETED": return "Payment";
    case "DISCOUNT_APPLIED": return "Discount";
    case "DISCOUNT_REMOVED": return "Discount removed";
    case "MARK_FREE": return "Free";
    case "UNMARK_FREE": return "Unfree";
    case "VOID_TICKETS": return "Void";
    case "UNVOID": return "Unvoid";
    case "PRICE_OVERRIDE": return "Price override";
    case "edit_line": return "Bill Edit";
    default: return a;
  }
}

function actionVariant(a: ActivityLog['action']): "default" | "secondary" | "destructive" | "outline" {
  if (a === "PAYMENT_COMPLETED") return "default";
  if (a === "VOID_TICKETS") return "destructive";
  if (a === "edit_line" || a === "DISCOUNT_APPLIED" || a === "PRICE_OVERRIDE" || a === "MARK_FREE") return "secondary";
  return "outline";
}


interface SessionLogCardProps {
    session: PendingSession;
}

export function SessionLogCard({ session }: SessionLogCardProps) {
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasFetched, setHasFetched] = useState(false);

    const handleOpen = (isOpen: boolean) => {
        if (isOpen && !hasFetched && !isLoading) {
            setIsLoading(true);
            const activityQuery = query(
                collection(db, "stores", session.storeId, "activityLogs"),
                where("sessionId", "==", session.id),
                orderBy("createdAt", "desc")
            );
            
            const unsubscribe = onSnapshot(activityQuery, (snapshot) => {
                setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActivityLog)));
                setIsLoading(false);
                setHasFetched(true);
                // Unsubscribe after the first fetch to avoid too many live listeners
                unsubscribe();
            }, (error) => {
                console.error(`Failed to fetch logs for session ${session.id}:`, error);
                setIsLoading(false);
            });
        }
    };
    
    const sessionLabel = computeSessionLabel(session);
    const sessionStarted = toJsDate(session.startedAt);

    return (
        <AccordionItem value={session.id} onOpenChange={handleOpen}>
            <Card>
                <AccordionTrigger className="p-4 w-full">
                    <div className="flex justify-between items-center w-full">
                        <div className="text-left">
                            <h3 className="font-semibold">{sessionLabel}</h3>
                            <p className="text-sm text-muted-foreground">
                                {sessionStarted ? format(sessionStarted, 'MMM d, h:mm a') : 'N/A'} - Status: <span className="capitalize">{session.status}</span>
                            </p>
                        </div>
                        <Badge variant={session.status === 'closed' || session.status === 'voided' ? 'outline' : 'default'} className="capitalize">{session.status}</Badge>
                    </div>
                </AccordionTrigger>
                <AccordionContent>
                    <div className="p-4 border-t">
                        {isLoading ? (
                            <div className="space-y-2">
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-full" />
                            </div>
                        ) : logs.length === 0 ? (
                             <p className="text-sm text-muted-foreground text-center py-4">No activity logs for this session.</p>
                        ) : (
                            <ScrollArea className="h-[200px] pr-3">
                                <div className="space-y-2">
                                    {logs.map(log => {
                                        const who = log.actorName?.trim() || log.actorRole || (log.actorUid ? log.actorUid.slice(0, 6) : "unknown");
                                        const item = log.meta?.itemName ? ` • ${log.meta.itemName}` : "";
                                        const receipt = log.meta?.receiptNumber ? ` • ${log.meta.receiptNumber}` : "";

                                        return (
                                            <div key={log.id} className="flex items-start gap-3 rounded-md border p-2">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <Badge variant={actionVariant(log.action)} className="whitespace-nowrap">
                                                        {actionLabel(log.action)}
                                                        </Badge>
                                                        <span className="text-xs text-muted-foreground">{fmtTime(log.createdAt)}</span>
                                                    </div>
                                                    <div className="text-sm mt-1">
                                                        <span className="font-medium">{who}</span>
                                                        <span className="text-muted-foreground">{item}{receipt}</span>
                                                    </div>
                                                    {(log.reason || log.note) && (
                                                        <div className="text-xs text-muted-foreground mt-1">
                                                            {log.reason ? `Reason: ${log.reason}` : log.note}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                        )}
                    </div>
                </AccordionContent>
            </Card>
        </AccordionItem>
    );
}
