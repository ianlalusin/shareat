
"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where, limit, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActivityLog } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { toJsDate } from "@/lib/utils/date";

function fmtTime(ts?: Timestamp | null) {
  if (!ts) return "";
  const d = toJsDate(ts);
  if (!d) return "";
  return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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

type Filter = "all" | "payments" | "bill_edits";

export function ActivityLogsCard({
  storeId,
  dateRange,
  onOpenReceipt,
}: {
  storeId: string;
  dateRange: { start: Date; end: Date };
  onOpenReceipt?: (sessionId: string) => void;
}) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return logs;
    if (filter === "payments") return logs.filter(l => l.action === "PAYMENT_COMPLETED");
    return logs.filter(l => l.action !== "PAYMENT_COMPLETED");
  }, [logs, filter]);

  useEffect(() => {
    if (!storeId) return;

    setIsLoading(true);

    const q = query(
      collection(db, "stores", storeId, "activityLogs"),
      where("createdAt", ">=", dateRange.start),
      where("createdAt", "<=", dateRange.end),
      orderBy("createdAt", "desc"),
      limit(40)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ActivityLog[];
        setLogs(rows);
        setIsLoading(false);
      },
      (err) => {
        console.error("ActivityLogsCard onSnapshot error:", err);
        setLogs([]);
        setIsLoading(false);
      }
    );

    return () => unsub();
  }, [storeId, dateRange.start, dateRange.end]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Activity Logs</CardTitle>
          <CardDescription>Latest cashier edits & payments for the selected period.</CardDescription>
        </div>

        <div className="min-w-[160px]">
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger><SelectValue placeholder="Filter" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="payments">Payments</SelectItem>
              <SelectItem value="bill_edits">Bill edits</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">No activity logs for this period.</p>
        ) : (
          <ScrollArea className="h-[320px] pr-3">
            <div className="space-y-2">
              {filtered.map((l) => {
                const who = l.actorName?.trim() || l.actorRole || (l.actorUid ? l.actorUid.slice(0, 6) : "unknown");
                const item = l.meta?.itemName ? ` • ${l.meta.itemName}` : "";
                const receipt = l.meta?.receiptNumber ? ` • ${l.meta.receiptNumber}` : "";
                const qtyDelta =
                  typeof l.meta?.qty === "number"
                    ? ` • qty ${l.meta.qty}`
                    : "";

                const canOpenReceipt = l.action === "PAYMENT_COMPLETED" && typeof onOpenReceipt === "function";

                return (
                  <div key={l.id} className="flex items-start gap-3 rounded-md border p-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={actionVariant(l.action)} className="whitespace-nowrap">
                          {actionLabel(l.action)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{fmtTime(l.createdAt)}</span>
                      </div>

                      <div className="text-sm mt-1">
                        <span className="font-medium">{who}</span>
                        <span className="text-muted-foreground">
                          {item}{receipt}{qtyDelta}
                        </span>
                      </div>

                      {(l.reason || l.note) && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {l.reason ? `Reason: ${l.reason}` : l.note}
                        </div>
                      )}
                    </div>

                    {canOpenReceipt && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenReceipt(l.sessionId)}
                        className="shrink-0"
                      >
                        Open
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
