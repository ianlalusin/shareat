

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import type { ActivityLog, PendingSession } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";
import { computeSessionLabel } from "@/lib/utils/session";
import { ScrollArea } from "../ui/scroll-area";

interface VoidsAndCompsCardProps {
    logs: (ActivityLog & { session: PendingSession })[];
    discountLogs: (ActivityLog & { session: PendingSession })[];
    isLoading: boolean;
}

function formatAmount(log: ActivityLog): string {
    const meta = (log.meta || {}) as any;

    if (log.action === "RECEIPT_VOIDED") {
        const total = meta.total ?? meta.snapshot?.total ?? meta.snapshot?.analytics?.grandTotal ?? 0;
        return total > 0 ? `- ₱${total.toFixed(2)}` : "—";
    }

    if (log.action === "SESSION_VOIDED") {
        return '—'; // Sessions are voided pre-payment, so no amount.
    }
    
    // Handle line item voids and free items
    if (log.action === "VOID_TICKETS" || log.action === "MARK_FREE") {
        if (typeof meta.amount === 'number' && Number.isFinite(meta.amount)) {
            return `- ₱${Math.abs(meta.amount).toFixed(2)}`;
        }
        return '—';
    }

    // Handle discount deltas for edits
    if (log.action === "DISCOUNT_EDITED") {
        if (typeof meta.delta === 'number' && Number.isFinite(meta.delta)) {
            const sign = meta.delta >= 0 ? '+' : '-';
            return `${sign} ₱${Math.abs(meta.delta).toFixed(2)}`;
        }
    }
    
    // Handle simple discount applications/removals
    if (log.action === "DISCOUNT_APPLIED" || log.action === "DISCOUNT_REMOVED") {
        if (typeof meta.amount === 'number' && Number.isFinite(meta.amount)) {
            const sign = log.action === "DISCOUNT_APPLIED" ? '-' : '+';
             return `${sign} ₱${Math.abs(meta.amount).toFixed(2)}`;
        }
    }

    return "—";
}


function getReason(log: ActivityLog): string {
    const meta = (log.meta || {}) as any;
    if (log.action === "DISCOUNT_APPLIED" || log.action === "DISCOUNT_EDITED" || log.action === "DISCOUNT_REMOVED") {
        return meta.discountName || log.note || "Discount event";
    }
    return log.reason || meta.reason || log.note || 'N/A';
}

function getActor(log: ActivityLog): string {
   return log.actorName || (log.actorUid ? log.actorUid.slice(0,8) : '—')
}

export function VoidsAndCompsCard({ logs, discountLogs, isLoading }: VoidsAndCompsCardProps) {
    const router = useRouter();
    const [filter, setFilter] = useState<'all' | 'voids' | 'free' | 'discounted'>('all');

    const filteredLogs = useMemo(() => {
        if (filter === 'all') return [...logs, ...discountLogs].sort((a,b) => (toJsDate(b.createdAt)?.getTime() ?? 0) - (toJsDate(a.createdAt)?.getTime() ?? 0));
        if (filter === 'voids') return logs.filter(log => log.action === 'VOID_TICKETS' || log.action === 'SESSION_VOIDED' || log.action === "RECEIPT_VOIDED");
        if (filter === 'free') return logs.filter(log => log.action === 'MARK_FREE');
        if (filter === 'discounted') return discountLogs;
        return [];
    }, [logs, discountLogs, filter]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Voids, Comps &amp; Discounts</CardTitle>
                <CardDescription>A summary of all voided, free, and discounted items.</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs value={filter} onValueChange={(v) => setFilter(v as any)} className="mb-4">
                    <TabsList>
                        <TabsTrigger value="all">All</TabsTrigger>
                        <TabsTrigger value="voids">Voids</TabsTrigger>
                        <TabsTrigger value="free">Free</TabsTrigger>
                        <TabsTrigger value="discounted">Discounts</TabsTrigger>
                    </TabsList>
                </Tabs>

                {isLoading ? (
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                ) : filteredLogs.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No relevant logs for this period.</p>
                ) : (
                    <ScrollArea className="h-[400px]">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background">
                                <TableRow>
                                    <TableHead>Item / Session</TableHead>
                                    <TableHead>Customer / Table</TableHead>
                                    <TableHead>Time</TableHead>
                                    <TableHead>Staff</TableHead>
                                    <TableHead>Reason</TableHead>
                                    <TableHead className="text-right">Amount/Delta</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredLogs.map(log => {
                                    const meta = (log.meta || {}) as any;
                                    const sessionLabel = computeSessionLabel(log.session);
                                    let itemLabel = "SESSION VOIDED";
                                    if (log.action === "RECEIPT_VOIDED") {
                                        itemLabel = `Receipt ${meta.receiptNumber} VOIDED`;
                                    } else if (log.action === "VOID_TICKETS") {
                                        itemLabel = `${meta.itemName} (VOID x${meta.qty ?? 1})`;
                                    } else if (log.action === "MARK_FREE") {
                                        itemLabel = `${meta.itemName} (FREE x${meta.qty ?? 1})`;
                                    } else if (log.action === "DISCOUNT_APPLIED") {
                                        itemLabel = `${meta.itemName || 'Bill Discount'}`;
                                    } else if (log.action === "DISCOUNT_EDITED") {
                                        itemLabel = `${meta.itemName || 'Bill Discount'} (Edited)`;
                                    } else if (log.action === "DISCOUNT_REMOVED") {
                                        itemLabel = `${meta.itemName || 'Bill Discount'} (Removed)`;
                                    }

                                    const auditHref = `/logs/sessions/${encodeURIComponent(log.storeId)}/${encodeURIComponent(log.sessionId)}?focus=${encodeURIComponent(log.id)}`;

                                    return (
                                        <TableRow
                                            key={log.id}
                                            className="cursor-pointer"
                                            tabIndex={0}
                                            onClick={() => router.push(auditHref)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    router.push(auditHref);
                                                }
                                            }}
                                        >
                                            <TableCell className="font-medium">{itemLabel}</TableCell>
                                            <TableCell>{sessionLabel}</TableCell>
                                            <TableCell>{format(toJsDate(log.createdAt)!, 'p')}</TableCell>
                                            <TableCell>{getActor(log)}</TableCell>
                                            <TableCell>{getReason(log)}</TableCell>
                                            <TableCell className="text-right font-mono">{formatAmount(log)}</TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                )}
            </CardContent>
        </Card>
    );
}
