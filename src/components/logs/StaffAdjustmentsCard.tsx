"use client";

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ShieldAlert, Users } from "lucide-react";
import type { ActivityLog } from "@/lib/types";

type StaffStat = {
  actorUid: string;
  actorName: string;
  voidCount: number;
  voidAmount: number;
  freeCount: number;
  freeAmount: number;
  discountCount: number;
  discountAmount: number;
  total: number; // combined peso value of voids + free + discounts
  flagged: boolean;
};

const VOID_ACTIONS: ActivityLog["action"][] = ["VOID_TICKETS", "SESSION_VOIDED", "RECEIPT_VOIDED"];
const FREE_ACTIONS: ActivityLog["action"][] = ["MARK_FREE"];
const DISCOUNT_ACTIONS: ActivityLog["action"][] = ["DISCOUNT_APPLIED"];

// Flag a cashier whose combined adjustment value is both materially above the
// per-cashier average and not trivially small. Tuneable, deliberately
// conservative so the badge stays meaningful.
const OUTLIER_FACTOR = 2;
const OUTLIER_FLOOR = 500; // pesos

function peso(n: number): string {
  return `₱${(Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function amountOf(log: ActivityLog): number {
  const m = log.meta || {};
  return Number((m as any).amount ?? (m as any).total ?? 0) || 0;
}

export function StaffAdjustmentsCard({ logs, isLoading }: { logs: ActivityLog[]; isLoading: boolean }) {
  const { stats, totals } = useMemo(() => {
    const byActor = new Map<string, StaffStat>();
    const get = (log: ActivityLog): StaffStat => {
      const uid = log.actorUid || "unknown";
      let s = byActor.get(uid);
      if (!s) {
        s = {
          actorUid: uid,
          actorName: log.actorName || "Unknown",
          voidCount: 0, voidAmount: 0, freeCount: 0, freeAmount: 0,
          discountCount: 0, discountAmount: 0, total: 0, flagged: false,
        };
        byActor.set(uid, s);
      } else if (s.actorName === "Unknown" && log.actorName) {
        s.actorName = log.actorName;
      }
      return s;
    };

    for (const log of logs) {
      if (VOID_ACTIONS.includes(log.action)) {
        const s = get(log); s.voidCount += 1; s.voidAmount += amountOf(log);
      } else if (FREE_ACTIONS.includes(log.action)) {
        const s = get(log); s.freeCount += 1; s.freeAmount += amountOf(log);
      } else if (DISCOUNT_ACTIONS.includes(log.action)) {
        const s = get(log); s.discountCount += 1; s.discountAmount += amountOf(log);
      }
    }

    const arr = Array.from(byActor.values());
    for (const s of arr) s.total = s.voidAmount + s.freeAmount + s.discountAmount;

    // Outlier detection across cashiers.
    if (arr.length >= 2) {
      const mean = arr.reduce((a, s) => a + s.total, 0) / arr.length;
      for (const s of arr) {
        if (s.total >= OUTLIER_FLOOR && s.total >= mean * OUTLIER_FACTOR) s.flagged = true;
      }
    }

    arr.sort((a, b) => b.total - a.total);

    const totals = arr.reduce(
      (acc, s) => {
        acc.voidCount += s.voidCount; acc.voidAmount += s.voidAmount;
        acc.freeCount += s.freeCount; acc.freeAmount += s.freeAmount;
        acc.discountCount += s.discountCount; acc.discountAmount += s.discountAmount;
        return acc;
      },
      { voidCount: 0, voidAmount: 0, freeCount: 0, freeAmount: 0, discountCount: 0, discountAmount: 0 },
    );

    return { stats: arr, totals };
  }, [logs]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" /> Adjustments by Staff
        </CardTitle>
        <CardDescription>
          Voids, comps and discounts attributed to each cashier for the selected range. Flagged rows are well above the team average.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-32"><Loader2 className="animate-spin" /></div>
        ) : stats.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">No adjustments in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cashier</TableHead>
                  <TableHead className="text-right">Voids</TableHead>
                  <TableHead className="text-right">Free</TableHead>
                  <TableHead className="text-right">Discounts</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((s) => (
                  <TableRow key={s.actorUid} className={s.flagged ? "bg-red-50/60" : undefined}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{s.actorName}</span>
                        {s.flagged && (
                          <Badge variant="outline" className="border-red-400 bg-red-50 text-red-600 text-[10px] px-1.5 py-0 gap-0.5">
                            <ShieldAlert className="h-3 w-3" /> Review
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <div>{peso(s.voidAmount)}</div>
                      <div className="text-muted-foreground">{s.voidCount}×</div>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <div>{peso(s.freeAmount)}</div>
                      <div className="text-muted-foreground">{s.freeCount}×</div>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <div>{peso(s.discountAmount)}</div>
                      <div className="text-muted-foreground">{s.discountCount}×</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{peso(s.total)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">All staff</TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-medium">{peso(totals.voidAmount)} <span className="text-muted-foreground">({totals.voidCount}×)</span></TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-medium">{peso(totals.freeAmount)} <span className="text-muted-foreground">({totals.freeCount}×)</span></TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-medium">{peso(totals.discountAmount)} <span className="text-muted-foreground">({totals.discountCount}×)</span></TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{peso(totals.voidAmount + totals.freeAmount + totals.discountAmount)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
