

"use client";

import { useMemo } from "react";
import { AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Scissors, Tag, Gift, Users, Package } from "lucide-react";
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
    case "SESSION_VERIFIED": return "Verified";
    case "PAYMENT_COMPLETED": return "Payment";
    case "DISCOUNT_APPLIED": return "Discount Applied";
    case "DISCOUNT_REMOVED": return "Discount Removed";
    case "DISCOUNT_EDITED": return "Discount Edited";
    case "BILL_DISCOUNT_APPLIED": return "Bill Discount";
    case "BILL_DISCOUNT_REMOVED": return "Bill Disc. Removed";
    case "CUSTOM_CHARGE_ADDED": return "Charge Added";
    case "CUSTOM_CHARGE_REMOVED": return "Charge Removed";
    case "MARK_FREE": return "Marked Free";
    case "UNMARK_FREE": return "Unmarked Free";
    case "VOID_TICKETS": return "Void";
    case "UNVOID": return "Un-void";
    case "PRICE_OVERRIDE": return "Price Override";
    case "edit_line": return "Bill Edit";
    case "PACKAGE_QTY_OVERRIDE_SET": return "Qty Override";
    case "PACKAGE_QTY_RESYNC_APPROVED_CHANGE": return "Qty Synced";
    case "ADDON_ADDED": return "Addon Added";
    case "REFILL_ADDED": return "Refill";
    case "GUEST_COUNT_REQUESTED": return "Guest Change Req";
    case "GUEST_COUNT_APPROVED": return "Guest Approved";
    case "GUEST_COUNT_REJECTED": return "Guest Rejected";
    case "PACKAGE_CHANGE_REQUESTED": return "Pkg Change Req";
    case "PACKAGE_CHANGE_APPROVED": return "Pkg Approved";
    case "PACKAGE_CHANGE_REJECTED": return "Pkg Rejected";
    case "TICKET_SERVED": return "Served";
    case "TICKET_CANCELLED": return "Cancelled";
    case "TICKET_BATCH_SERVED": return "Batch Served";
    case "TICKET_REMAINING_CANCELLED": return "Remaining Cancelled";
    case "RECEIPT_EDITED": return "Receipt Edited";
    case "RECEIPT_VOIDED": return "Receipt Voided";
    default: return a.replace(/_/g, " ");
  }
}

function formatAmount(log: ActivityLog): string {
    const meta = (log.meta || {}) as any;
    
    // Check for a specific 'delta' first for discount edits
    if (typeof meta.delta === 'number' && Number.isFinite(meta.delta)) {
        const sign = meta.delta >= 0 ? '+' : '-';
        return `${sign} ₱${Math.abs(meta.delta).toFixed(2)}`;
    }
    
    // Then check for a general 'amount' or 'total'
    const amount = meta.amount ?? meta.paymentTotal ?? meta.discountValue ?? meta.total ?? undefined;

    if (typeof amount === 'number' && Number.isFinite(amount)) {
        let sign = '';
        if (log.action.includes('VOID') || log.action === 'MARK_FREE' || log.action === 'DISCOUNT_APPLIED') {
            sign = '- ';
        } else if (log.action === 'DISCOUNT_REMOVED' || log.action === 'UNMARK_FREE') {
            sign = '+ ';
        }
        // No sign for payment completed or other neutral amounts
        return `${sign}₱${Math.abs(amount).toFixed(2)}`;
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
    if (log.action === "SESSION_VOIDED" || log.action === "RECEIPT_VOIDED") {
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

    const adjustmentFlags = useMemo(() => {
        const actions = new Set(initialLogs.map(l => l.action));
        return {
            hasVoids: actions.has("VOID_TICKETS") || actions.has("SESSION_VOIDED") || actions.has("TICKET_CANCELLED") || actions.has("TICKET_REMAINING_CANCELLED"),
            hasDiscounts: actions.has("DISCOUNT_APPLIED") || actions.has("DISCOUNT_EDITED") || actions.has("BILL_DISCOUNT_APPLIED"),
            hasFree: actions.has("MARK_FREE"),
            hasGuestChange: actions.has("GUEST_COUNT_APPROVED") || actions.has("GUEST_COUNT_REQUESTED"),
            hasPackageChange: actions.has("PACKAGE_CHANGE_APPROVED") || actions.has("PACKAGE_CHANGE_REQUESTED"),
        };
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
                        <div className="flex items-center gap-1 shrink-0">
                            {adjustmentFlags.hasVoids && (
                                <Badge variant="outline" className="border-red-400 bg-red-50 text-red-600 text-[10px] px-1.5 py-0 gap-0.5">
                                    <Scissors className="h-3 w-3" /> Void
                                </Badge>
                            )}
                            {adjustmentFlags.hasDiscounts && (
                                <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-600 text-[10px] px-1.5 py-0 gap-0.5">
                                    <Tag className="h-3 w-3" /> Disc
                                </Badge>
                            )}
                            {adjustmentFlags.hasFree && (
                                <Badge variant="outline" className="border-green-400 bg-green-50 text-green-600 text-[10px] px-1.5 py-0 gap-0.5">
                                    <Gift className="h-3 w-3" /> Free
                                </Badge>
                            )}
                            {adjustmentFlags.hasGuestChange && (
                                <Badge variant="outline" className="border-blue-400 bg-blue-50 text-blue-600 text-[10px] px-1.5 py-0 gap-0.5">
                                    <Users className="h-3 w-3" /> Guest
                                </Badge>
                            )}
                            {adjustmentFlags.hasPackageChange && (
                                <Badge variant="outline" className="border-violet-400 bg-violet-50 text-violet-600 text-[10px] px-1.5 py-0 gap-0.5">
                                    <Package className="h-3 w-3" /> Pkg
                                </Badge>
                            )}
                            <Badge variant={session.status === 'voided' ? 'destructive' : session.status === 'closed' ? 'outline' : 'default'} className="capitalize">{session.status}</Badge>
                        </div>
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
