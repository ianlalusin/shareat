
"use client";

import { useState } from "react";
import { addDays, format } from "date-fns";
import { PageHeader } from "@/components/page-header";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { reconcileRange, type ReconcileRow } from "@/lib/analytics/reconcile";
import { rebuildDailyAnalyticsFromReceipts } from "@/lib/analytics/backfill";
import { db } from "@/lib/firebase/client";
import { cn } from "@/lib/utils";

function parseDayId(dayId: string) {
    const year = parseInt(dayId.substring(0, 4), 10);
    const month = parseInt(dayId.substring(4, 6), 10) - 1; // month is 0-indexed
    const day = parseInt(dayId.substring(6, 8), 10);
    return new Date(year, month, day);
}

export default function ReconcilePage() {
    const { activeStore } = useStoreContext();
    const { toast } = useToast();
    const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>({
        start: addDays(new Date(), -7),
        end: new Date(),
    });
    const [results, setResults] = useState<ReconcileRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [rebuildingDay, setRebuildingDay] = useState<string | null>(null);

    const handleRunReconciliation = async () => {
        if (!activeStore) return;
        setIsLoading(true);
        setResults([]);
        try {
            const data = await reconcileRange(activeStore.id, dateRange.start, dateRange.end);
            setResults(data);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error Running Reconciliation', description: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const handleRebuildDay = async (dayId: string) => {
        if (!activeStore) return;
        setRebuildingDay(dayId);
        toast({ title: 'Rebuilding Day...', description: `Processing ${dayId}.`});
        try {
            const date = parseDayId(dayId);
            await rebuildDailyAnalyticsFromReceipts(db, activeStore.id, date, date, () => {});
            toast({ title: 'Rebuild Complete', description: `Analytics for ${dayId} have been rebuilt.`});
            // Re-run the reconciliation to show the updated status
            handleRunReconciliation();
        } catch (error: any) {
             toast({ variant: 'destructive', title: 'Rebuild Failed', description: error.message });
        } finally {
            setRebuildingDay(null);
        }
    }
    
    if (!activeStore) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Reconciliation Tool</CardTitle>
                    <CardDescription>Please select a store to use this tool.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <RoleGuard allow={["admin"]}>
            <PageHeader title="Analytics Reconciliation" description="Verify that aggregated daily analytics match the source-of-truth receipts." />
            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                        <div className="space-y-1">
                            <CardTitle>Run Check</CardTitle>
                            <CardDescription>Select a date range and run the check.</CardDescription>
                        </div>
                        <div className="flex gap-4 items-center">
                            <DateRangePicker onDateChange={setDateRange} />
                            <Button onClick={handleRunReconciliation} disabled={isLoading}>
                                {isLoading ? <Loader2 className="animate-spin mr-2" /> : <ShieldAlert className="mr-2"/>}
                                Run Check
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex justify-center items-center h-40"><Loader2 className="animate-spin" /></div>
                    ) : results.length === 0 ? (
                        <div className="text-center text-muted-foreground py-10">Select a date range and click "Run Check" to see results.</div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Day</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Net Sales Diff</TableHead>
                                    <TableHead>Tx Count Diff</TableHead>
                                    <TableHead>MOP Diff</TableHead>
                                    <TableHead className="text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {results.map(row => (
                                    <TableRow key={row.dayId} className={!row.ok ? "bg-destructive/10" : ""}>
                                        <TableCell>{format(parseDayId(row.dayId), "MMM dd, yyyy")}</TableCell>
                                        <TableCell>
                                            {row.ok ? <CheckCircle2 className="text-green-500" /> : <AlertTriangle className="text-destructive" />}
                                        </TableCell>
                                        <TableCell className={cn(row.netDiff !== 0 && "font-bold text-destructive")}>
                                            ₱{row.netDiff.toFixed(2)}
                                        </TableCell>
                                        <TableCell className={cn(row.txDiff !== 0 && "font-bold text-destructive")}>
                                            {row.txDiff}
                                        </TableCell>
                                         <TableCell>
                                            {Object.values(row.mopDiff).some(d => Math.abs(d) > 0.01) ? "Yes" : "No"}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {!row.ok && (
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleRebuildDay(row.dayId)}
                                                    disabled={rebuildingDay === row.dayId}
                                                >
                                                    {rebuildingDay === row.dayId ? <Loader2 className="animate-spin mr-2"/> : null}
                                                    Rebuild Day
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </RoleGuard>
    )
}
