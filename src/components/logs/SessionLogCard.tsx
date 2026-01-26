

"use client";

import { useMemo } from "react";
import { AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ActivityLog, PendingSession } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";
import { format } from "date-fns";
import { computeSessionLabel } from "@/lib/utils/session";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

function fmtTime(ts?: any) {
  const d = toJsDate(ts);
  if (!d) return "—";
  return format(d, "h:mm:ss a");
}

function actionLabel(a: ActivityLog['action']) {
  switch (a) {
    case "SESSION_STARTED": return "Session Started";
    case "SESSION_VOIDED": return "Session Voided";
    case "PAYMENT_COMPLETED": return "Payment";
    case "DISCOUNT_APPLIED": return "Discount Applied";
    case "DISCOUNT_REMOVED": return "Discount Removed";
    case "MARK_FREE": return "Marked Free";
    case "UNMARK_FREE": return "Unmarked Free";
    case "VOID_TICKETS": return "Void";
    case "UNVOID": return "Un-void";
    case "PRICE_OVERRIDE": return "Price Override";
    case "edit_line": return "Bill Edit";
    default: return a;
  }
}

function formatAmount(log: ActivityLog): string {
    const meta = log.meta || {};
    const amount = 'amount' in meta && typeof meta.amount === 'number' ? meta.amount : 'paymentTotal' in meta && typeof meta.paymentTotal === 'number' ? meta.paymentTotal : 'discountValue' in meta && typeof meta.discountValue === 'number' ? meta.discountValue : undefined;

    if (typeof amount === 'number') {
        const sign = log.action === 'DISCOUNT_REMOVED' || log.action === 'UNMARK_FREE' ? '+' : (amount < 0 ? '' : (log.action === 'PAYMENT_COMPLETED' ? '' : '-'));
        return `${sign} ₱${Math.abs(amount).toFixed(2)}`;
    }
    return "—";
}


function formatDescription(log: ActivityLog): string {
    const meta = (log.meta ?? {}) as any;

    if (log.action === 'PAYMENT_COMPLETED') {
        return `Paid via ${Object.keys(meta.mopSummary || {}).join(', ')}`;
    }
    if (log.action === "SESSION_STARTED") {
        return "Session created by cashier.";
    }
    if (log.action === "SESSION_VOIDED") {
        const reason = log.reason || meta.reason || "N/A";
        return `Session voided. Reason: ${reason}`;
    }

    const qtyNum =
      typeof meta.qty === "number" ? meta.qty :
      typeof meta.quantity === "number" ? meta.quantity :
      typeof meta.qtyChanged === "number" ? meta.qtyChanged :
      undefined;

    const qty = typeof qtyNum === "number" && qtyNum > 0 ? `${qtyNum}x ` : "";
    const item = 'itemName' in meta ? `${meta.itemName}` : '';
    const reason = log.reason || log.note ? ` - Reason: ${log.reason || log.note}` : "";

    return `${qty}${item}${reason}`;
}

export function formatLogForExport(log: ActivityLog) {
  const d = toJsDate(log.createdAt);
  return {
    "Session ID": log.sessionId.substring(0, 8),
    "Date": d ? format(d, 'yyyy-MM-dd') : 'N/A',
    "Time": d ? format(d, 'HH:mm:ss') : 'N/A',
    "Action": actionLabel(log.action),
    "Actor": log.actorName || log.actorUid,
    "Description": formatDescription(log),
    "Amount": formatAmount(log),
  };
}

interface SessionLogCardProps {
    session: PendingSession & { createdAt?: any; startedAtClientMs?: number | undefined; };
    initialLogs: ActivityLog[];
}

export function SessionLogCard({ session, initialLogs }: SessionLogCardProps) {
    const sessionLabel = computeSessionLabel(session);
    const sessionStarted = toJsDate(session.startedAt) ?? toJsDate((session as any).createdAt) ?? (session.startedAtClientMs ? new Date(session.startedAtClientMs) : null);

    // Deduplicate logs just in case, using the unique document ID
    const logs = useMemo(() => {
        const sorted = initialLogs.sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return timeB - timeA;
        });
        return Array.from(new Map(sorted.map((l, i) => [(l.id ?? `__${i}`), l])).values());
    }, [initialLogs]);


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
                    {logs.length === 0 ? (
                         <p className="text-sm text-muted-foreground text-center py-4 px-4">No activity logs for this session.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Action</TableHead>
                                    <TableHead>Who</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                    <TableHead className="text-right">Time</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {logs.map(log => (
                                    <TableRow key={log.id}>
                                        <TableCell><Badge variant="secondary" className="whitespace-nowrap">{actionLabel(log.action)}</Badge></TableCell>
                                        <TableCell>{log.actorName || log.actorRole || 'System'}</TableCell>
                                        <TableCell>{formatDescription(log)}</TableCell>
                                        <TableCell className="text-right font-mono">{formatAmount(log)}</TableCell>
                                        <TableCell className="text-right text-muted-foreground">{fmtTime(log.createdAt)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </AccordionContent>
            </Card>
        </AccordionItem>
    );
}
