
"use client";

import { useMemo, useState } from "react";
import { db } from "@/lib/firebase/client";
import { reconcileRange, type ReconcileRow } from "@/lib/analytics/reconcile";
import { rebuildDailyAnalyticsFromReceipts } from "@/lib/analytics/backfill";
import { reconcileMonthsFromDays, reconcileYearFromMonths, type RollupReconcileRow } from "@/lib/analytics/reconcile-rollups";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { useStoreContext } from "@/context/store-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

function fmtCurrency(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `₱${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminReconcilePage() {
  const { activeStore } = useStoreContext();

  const [start, setStart] = useState(() => new Date());
  const [end, setEnd] = useState(() => new Date());
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [rows, setRows] = useState<ReconcileRow[]>([]);
  
  const [mode, setMode] = useState<"receipts" | "rollups">("receipts");
  const [yearToReconcile, setYearToReconcile] = useState(new Date().getFullYear());
  const [monthRows, setMonthRows] = useState<RollupReconcileRow[]>([]);
  const [yearRow, setYearRow] = useState<RollupReconcileRow | null>(null);

  const badRows = useMemo(() => rows.filter((r) => !r.ok), [rows]);

  const run = async () => {
    if (!activeStore?.id) {
        toast({ variant: "destructive", title: "No store selected", description: "Select a store first." });
        return;
    }

    setIsRunning(true);
    setProgress(mode === "receipts" ? "Reconciling receipts vs daily…" : "Reconciling rollups…");

    try {
        if (mode === "receipts") {
            const result = await reconcileRange(activeStore.id, start, end);
            setRows(result);
            setMonthRows([]);
            setYearRow(null);

            toast({
                title: "Reconcile complete",
                description: `${result.length} day(s) checked, ${result.filter(r => !r.ok).length} mismatch(es).`,
            });
            return;
        }

        // rollups mode: use selected year from state
        const months = await reconcileMonthsFromDays(activeStore.id, yearToReconcile);
        const yr = await reconcileYearFromMonths(activeStore.id, yearToReconcile);

        setMonthRows(months);
        setYearRow(yr);
        setRows([]);

        const badMonths = months.filter(m => !m.ok).length;
        toast({
            title: "Rollup reconcile complete",
            description: `${badMonths} mismatched month(s). Year: ${yr.ok ? "ok" : "mismatch"}.`,
        });
    } catch (e: any) {
        console.error(e);
        toast({ variant: "destructive", title: "Reconcile failed", description: e?.message ?? "Error" });
    } finally {
        setIsRunning(false);
        setProgress("");
    }
  };
  
  const rebuildDay = async (dayId: string) => {
    if (!activeStore?.id) return;

    const y = Number(dayId.slice(0, 4));
    const m = Number(dayId.slice(4, 6)) - 1;
    const d = Number(dayId.slice(6, 8));
    
    const dayStart = new Date(y, m, d);
    dayStart.setHours(0, 0, 0, 0);
    
    const dayEnd = new Date(y, m, d);
    dayEnd.setHours(23, 59, 59, 999);

    setIsRunning(true);
    setProgress(`Rebuilding ${dayId}…`);
    try {
      await rebuildDailyAnalyticsFromReceipts(db, activeStore.id, dayStart, dayEnd, (msg) => setProgress(msg));
      toast({ title: "Rebuild complete", description: `Rebuilt analytics for ${dayId}. Re-run reconcile to confirm.` });
    } catch (e: any) {
      console.error(e);
      toast({ variant: "destructive", title: "Rebuild failed", description: e?.message ?? "Error" });
    } finally {
      setIsRunning(false);
      setProgress("");
    }
  };

  const rebuildAllMismatched = async () => {
    if (!activeStore?.id) return;
    const targets = rows.filter((r) => !r.ok).map((r) => r.dayId);
    if (targets.length === 0) {
      toast({ title: "Nothing to rebuild", description: "No mismatched days found." });
      return;
    }

    setIsRunning(true);
    try {
      for (let i = 0; i < targets.length; i++) {
        const dayId = targets[i];
        setProgress(`Rebuilding ${dayId} (${i + 1}/${targets.length})…`);

        const y = Number(dayId.slice(0, 4));
        const m = Number(dayId.slice(4, 6)) - 1;
        const d = Number(dayId.slice(6, 8));
        
        const dayStart = new Date(y, m, d);
        dayStart.setHours(0, 0, 0, 0);

        const dayEnd = new Date(y, m, d);
        dayEnd.setHours(23, 59, 59, 999);

        await rebuildDailyAnalyticsFromReceipts(db, activeStore.id, dayStart, dayEnd, (msg) =>
          setProgress(`${dayId}: ${msg}`)
        );
      }

      toast({ title: "Bulk rebuild complete", description: `Rebuilt ${targets.length} day(s). Re-run reconcile to confirm.` });
    } catch (e: any) {
      console.error(e);
      toast({ variant: "destructive", title: "Bulk rebuild failed", description: e?.message ?? "Error" });
    } finally {
      setIsRunning(false);
      setProgress("");
    }
  };
  
   const rebuildMonth = async (monthId: string) => {
    if (!activeStore?.id) return;
    const year = parseInt(monthId.slice(0, 4));
    const month = parseInt(monthId.slice(4, 6)) - 1;
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0); // Last day of the month
    
    setIsRunning(true);
    setProgress(`Rebuilding ${monthId}...`);
    try {
      await rebuildDailyAnalyticsFromReceipts(db, activeStore.id, startDate, endDate, (msg) => setProgress(`${monthId}: ${msg}`));
      toast({ title: `Month ${monthId} rebuilt`, description: "Re-run rollup reconcile to confirm." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Rebuild failed", description: e.message });
    } finally {
      setIsRunning(false);
    }
  };

  const rebuildYear = async (year: number) => {
    if (!activeStore?.id) return;

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    setIsRunning(true);
    try {
        setProgress(`Rebuilding ${year}…`);
        await rebuildDailyAnalyticsFromReceipts(db, activeStore.id, yearStart, yearEnd, (msg) => setProgress(`${year}: ${msg}`));
        toast({ title: "Year rebuild complete", description: `Rebuilt days for ${year}. Re-run rollup reconcile.` });
    } catch (e: any) {
        console.error(e);
        toast({ variant: "destructive", title: "Year rebuild failed", description: e?.message ?? "Error" });
    } finally {
        setIsRunning(false);
        setProgress("");
    }
    };

  const currentYear = new Date().getFullYear();
  const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Analytics Reconcile</CardTitle>
          <CardDescription>Tools to verify and correct analytics data integrity.</CardDescription>
        </CardHeader>
        <CardContent>
            <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="receipts">Receipts vs Daily</TabsTrigger>
                    <TabsTrigger value="rollups">Rollup Tiers</TabsTrigger>
                </TabsList>
                <TabsContent value="receipts" className="space-y-3 pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                        <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Start date</div>
                        <Input type="date" value={start.toISOString().slice(0, 10)} onChange={(e) => setStart(new Date(e.target.value))}/>
                        </div>
                        <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">End date</div>
                        <Input type="date" value={end.toISOString().slice(0, 10)} onChange={(e) => setEnd(new Date(e.target.value))}/>
                        </div>
                        <Button className="w-full" onClick={run} disabled={isRunning}>{isRunning ? "Working…" : "Run Reconcile"}</Button>
                    </div>
                     <Button variant="secondary" className="w-full" onClick={rebuildAllMismatched} disabled={isRunning || badRows.length === 0}>Rebuild all mismatched</Button>
                </TabsContent>
                 <TabsContent value="rollups" className="space-y-3 pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Year</div>
                            <Select value={String(yearToReconcile)} onValueChange={(val) => setYearToReconcile(Number(val))}>
                                <SelectTrigger><SelectValue/></SelectTrigger>
                                <SelectContent>
                                    {availableYears.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="sm:col-span-2">
                            <Button className="w-full" onClick={run} disabled={isRunning}>{isRunning ? "Working..." : "Run Rollup Reconcile"}</Button>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
            {progress && <div className="text-xs text-muted-foreground pt-2">{progress}</div>}
        </CardContent>
      </Card>
      
        {rows.length > 0 && mode === 'receipts' && (
            <Card>
            <CardHeader><CardTitle>Receipts vs Daily Results</CardTitle></CardHeader>
            <CardContent className="space-y-2">
                {rows.map((r) => {
                const isMissingRollup = !r.ok && r.rollupTx === 0 && r.receiptTx > 0;
                return (
                <div key={r.dayId} className={cn("rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2", r.ok && "opacity-70")}>
                    <div className="space-y-1">
                    <div className="text-sm font-medium">
                        {r.dayId}{" "}
                        {!r.ok ? <span className="text-red-600 font-normal">• mismatch</span> : <span className="text-muted-foreground font-normal">• ok</span>}
                        {isMissingRollup && <span className="text-red-600 font-normal ml-2">• Missing Rollup</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">Receipts: {fmtCurrency(r.receiptNet)} ({r.receiptTx} tx) • Rollup: {fmtCurrency(r.rollupNet)} ({r.rollupTx} tx)</div>
                    {!r.ok && (<div className="text-xs text-muted-foreground">Net diff: {fmtCurrency(r.netDiff)} • Tx diff: {r.txDiff}</div>)}
                    </div>
                    <div className="flex gap-2"><Button variant="secondary" onClick={() => rebuildDay(r.dayId)} disabled={isRunning || r.ok}>Rebuild day</Button></div>
                </div>
                )})}
            </CardContent>
            </Card>
        )}

        {mode === 'rollups' && yearRow && (
            <Card>
                <CardHeader><CardTitle>Yearly Rollup vs Monthly Sums ({yearRow.id})</CardTitle></CardHeader>
                <CardContent>
                     <div className={cn("rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2", yearRow.ok && "opacity-70")}>
                        <div className="space-y-1">
                            <div className="text-sm font-medium">
                                {yearRow.id} {!yearRow.ok ? <span className="text-red-600 font-normal">• mismatch</span> : <span className="text-muted-foreground font-normal">• ok</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">Sum of Months: {fmtCurrency(yearRow.sumNet)} ({yearRow.sumTx} tx) • Rollup: {fmtCurrency(yearRow.rollupNet)} ({yearRow.rollupTx} tx)</div>
                            {!yearRow.ok && (<div className="text-xs text-muted-foreground">Net diff: {fmtCurrency(yearRow.netDiff)} • Tx diff: {yearRow.txDiff}</div>)}
                        </div>
                         <Button variant="secondary" onClick={() => rebuildYear(Number(yearRow.id))} disabled={isRunning || yearRow.ok} className="mt-2">
                            Rebuild Entire Year
                        </Button>
                    </div>
                </CardContent>
            </Card>
        )}

        {mode === 'rollups' && monthRows.length > 0 && (
             <Card>
                <CardHeader><CardTitle>Monthly Rollups vs Daily Sums</CardTitle></CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Net Diff</TableHead><TableHead>Tx Diff</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {monthRows.map(row => (
                                <TableRow key={row.id} className={cn(row.ok && "text-muted-foreground")}>
                                    <TableCell className="font-medium">{row.id}</TableCell>
                                    <TableCell className={cn(Math.abs(row.netDiff) > 2 && "text-destructive font-bold")}>{fmtCurrency(row.netDiff)}</TableCell>
                                    <TableCell className={cn(row.txDiff !== 0 && "text-destructive font-bold")}>{row.txDiff}</TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="secondary" size="sm" onClick={() => rebuildMonth(row.id)} disabled={isRunning || row.ok}>Rebuild Month</Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
             </Card>
        )}
    </div>
  );
}
