

"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyMetric, TopAddonRow } from "@/lib/types";

function fmtCurrency(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `₱${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface TopAddonItemsCardProps {
  dailyMetrics: DailyMetric[];
  topAddonItems: TopAddonRow[];
  hasTopAddonItems: boolean;
  isLoading: boolean;
}

export function TopAddonItemsCard({ dailyMetrics, topAddonItems, hasTopAddonItems, isLoading }: TopAddonItemsCardProps) {

  const totalAddonSales = useMemo(() => {
    let total = 0;
    (dailyMetrics || []).forEach((m) => {
      const byCat = m?.sales?.addonSalesAmountByCategory ?? {};
      for (const v of Object.values(byCat)) total += Number(v ?? 0);
    });
    return total;
  }, [dailyMetrics]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Top Add-ons (Items)</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
          </div>
        ) : !hasTopAddonItems ? (
          <div className="text-sm text-center text-muted-foreground">Top item data is not available for custom date ranges.</div>
        ) : topAddonItems.length === 0 ? (
          <div className="text-sm text-center text-muted-foreground">No add-on data for this range.</div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground text-center">
              Total add-on sales (by category):{" "}
              <span className="font-medium text-foreground">{fmtCurrency(totalAddonSales)}</span>
            </div>

            <div className="space-y-2">
              {topAddonItems.map((it, idx) => (
                <div key={`${it.name}-${idx}`} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{it.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{it.categoryName}</div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums">{fmtCurrency(it.amount)}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {Number(it.qty || 0).toLocaleString("en-US")} qty
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
