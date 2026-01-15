
"use client";

import { useMemo, useState } from "react";
import { db } from "@/lib/firebase/client";
import { reconcileRange, type ReconcileRow } from "@/lib/analytics/reconcile";
import { rebuildDailyAnalyticsFromReceipts } from "@/lib/analytics/backfill";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

// If you already have a store selector/context, replace this with your active store hook
import { useStoreContext } from "@/context/store-context";

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

  const badRows = useMemo(() => rows.filter((r) => !r.ok), [rows]);

  const run = async () => {
    if (!activeStore?.id) {
      toast({ variant: "destructive", title: "No store selected", description: "Select a store first." });
      return;
    }
    setIsRunning(true);
    setProgress("Reconciling…");
    try {
      const result = await reconcileRange(activeStore.id, start, end);
      setRows(result);
      toast({
        title: "Reconcile complete",
        description: `${result.length} day(s) checked, ${result.filter(r => !r.ok).length} mismatch(es).`,
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

    // Convert YYYYMMDD to Date range [dayStart, dayEnd]
    const y = Number(dayId.slice(0, 4));
    const m = Number(dayId.slice(4, 6)) - 1;
    const d = Number(dayId.slice(6, 8));
    
    const dayStart = new Date(y, m, d);
    dayStart.setHours(0, 0, 0, 0); // Start of day
    
    const dayEnd = new Date(y, m, d);
    dayEnd.setHours(23, 59, 59, 999); // End of day

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

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Analytics Reconcile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Start date</div>
              <Input
                type="date"
                value={start.toISOString().slice(0, 10)}
                onChange={(e) => setStart(new Date(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">End date</div>
              <Input
                type="date"
                value={end.toISOString().slice(0, 10)}
                onChange={(e) => setEnd(new Date(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Button className="w-full" onClick={run} disabled={isRunning}>
                {isRunning ? "Working…" : "Run Reconcile"}
              </Button>
            </div>
          </div>
          <Button
            variant="secondary"
            className="w-full"
            onClick={rebuildAllMismatched}
            disabled={isRunning || badRows.length === 0}
          >
            Rebuild all mismatched
          </Button>

          {progress ? <div className="text-xs text-muted-foreground">{progress}</div> : null}

          {rows.length > 0 ? (
            <div className="text-sm">
              Checked: <span className="font-medium">{rows.length}</span> day(s) • Mismatches:{" "}
              <span className="font-medium">{badRows.length}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {rows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.map((r) => (
              <div
                key={r.dayId}
                className={`rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 ${
                  r.ok ? "opacity-70" : ""
                }`}
              >
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {r.dayId}{" "}
                    {!r.ok ? <span className="text-red-600 font-normal">• mismatch</span> : <span className="text-muted-foreground font-normal">• ok</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Receipts: {fmtCurrency(r.receiptNet)} ({r.receiptTx} tx) • Rollup: {fmtCurrency(r.rollupNet)} ({r.rollupTx} tx)
                  </div>
                  {!r.ok ? (
                    <div className="text-xs text-muted-foreground">
                      Net diff: {fmtCurrency(r.netDiff)} • Tx diff: {r.txDiff}
                    </div>
                  ) : null}
                </div>

                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => rebuildDay(r.dayId)} disabled={isRunning || r.ok}>
                    Rebuild day
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
