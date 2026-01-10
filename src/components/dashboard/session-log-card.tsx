
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
  return d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" });
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
    initialLogs: ActivityLog[];
}

export function SessionLogCard({ session, initialLogs }: SessionLogCardProps) {
    const sessionLabel = computeSessionLabel(session);
    const sessionStarted = toJsDate(session.startedAt);

    return (
        <AccordionItem value={session.id}>
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
                    <div className="px-4 pb-4 border-t">
                        {initialLogs.length === 0 ? (
                             <p className="text-sm text-muted-foreground text-center py-4">No activity logs for this session.</p>
                        ) : (
                            <ScrollArea className="h-[200px] pr-3">
                                <div className="space-y-1 py-2">
                                    {initialLogs.map(log => {
                                        const who = log.actorName?.trim() || log.actorRole || (log.actorUid ? log.actorUid.slice(0, 6) : "unknown");
                                        const item = log.meta?.itemName ? ` on ${log.meta.itemName}` : "";
                                        const reason = log.reason || log.note ? ` - Reason: ${log.reason || log.note}` : "";

                                        return (
                                            <div key={log.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                                                <Badge variant={actionVariant(log.action)} className="whitespace-nowrap h-5">
                                                    {actionLabel(log.action)}
                                                </Badge>
                                                <span className="font-medium">{who}</span>
                                                <span className="text-muted-foreground truncate flex-1">
                                                    {item}{reason}
                                                </span>
                                                <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">{fmtTime(log.createdAt)}</span>
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
