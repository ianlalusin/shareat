
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
    const amount = 'amount' in meta ? meta.amount : 'paymentTotal' in meta ? meta.paymentTotal : 'discountValue' in meta ? meta.discountValue : undefined;

    if (typeof amount === 'number') {
        const sign = log.action === 'DISCOUNT_REMOVED' || log.action === 'UNMARK_FREE' ? '+' : (amount < 0 ? '' : (log.action === 'PAYMENT_COMPLETED' ? '' : '-'));
        return `${sign} ₱${Math.abs(amount).toFixed(2)}`;
    }
    return "—";
}

function formatDescription(log: ActivityLog): string {
    const meta = log.meta || {};
    if (log.action === 'PAYMENT_COMPLETED') {
        return `Paid via ${Object.keys(meta.mopSummary || {}).join(', ')}`;
    }

    const qty = log.qty ? `${log.qty}x ` : '';
    const item = 'itemName' in meta ? `${meta.itemName}` : '';
    const reason = log.reason || log.note ? ` - Reason: ${log.reason || log.note}` : "";

    return `${qty}${item}${reason}`;
}

interface SessionLogCardProps {
    session: PendingSession;
    initialLogs: ActivityLog[];
}

export function SessionLogCard({ session, initialLogs }: SessionLogCardProps) {
    const sessionLabel = computeSessionLabel(session);
    const sessionStarted = toJsDate(session.startedAt);

    // Deduplicate logs just in case, using the unique document ID
    const logs = useMemo(() => {
        return Array.from(new Map(initialLogs.map((l, i) => [(l.id ?? `__${i}`), l])).values());
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
