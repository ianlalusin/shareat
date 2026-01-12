
"use client";

import { useMemo, useState } from "react";
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
    isLoading: boolean;
}

function formatAmount(log: ActivityLog): string {
    const meta = log.meta || {};
    if ('unitPrice' in meta && 'qty' in meta && typeof meta.unitPrice === 'number' && typeof meta.qty === 'number') {
        const total = meta.unitPrice * meta.qty;
        return `₱${total.toFixed(2)}`;
    }
    return '—';
}

function getReason(log: ActivityLog): string {
    return log.reason || log.note || 'N/A';
}

export function VoidsAndCompsCard({ logs, isLoading }: VoidsAndCompsCardProps) {
    const [filter, setFilter] = useState<'all' | 'voids' | 'free'>('all');

    const filteredLogs = useMemo(() => {
        if (filter === 'all') return logs;
        if (filter === 'voids') return logs.filter(log => log.action === 'VOID_TICKETS' || log.action === 'SESSION_VOIDED');
        if (filter === 'free') return logs.filter(log => log.action === 'MARK_FREE');
        return [];
    }, [logs, filter]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Voids & Comps</CardTitle>
                <CardDescription>A summary of all voided and free items.</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs value={filter} onValueChange={(v) => setFilter(v as any)} className="mb-4">
                    <TabsList>
                        <TabsTrigger value="all">All</TabsTrigger>
                        <TabsTrigger value="voids">Voids</TabsTrigger>
                        <TabsTrigger value="free">Free</TabsTrigger>
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
                                    <TableHead>Reason</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredLogs.map(log => {
                                    const meta = (log.meta || {}) as any;
                                    const sessionLabel = computeSessionLabel(log.session);
                                    let itemLabel = "SESSION VOIDED";
                                    if (log.action === "VOID_TICKETS") {
                                        itemLabel = `${meta.itemName} (VOID x${meta.qty ?? 1})`;
                                    } else if (log.action === "MARK_FREE") {
                                        itemLabel = `${meta.itemName} (FREE x${meta.qty ?? 1})`;
                                    }

                                    return (
                                        <TableRow key={log.id}>
                                            <TableCell className="font-medium">{itemLabel}</TableCell>
                                            <TableCell>{sessionLabel}</TableCell>
                                            <TableCell>{format(toJsDate(log.createdAt)!, 'p')}</TableCell>
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
