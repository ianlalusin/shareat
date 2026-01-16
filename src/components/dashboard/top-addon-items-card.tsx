"use client";

import { useEffect, useMemo, useState } from "react";
import { doc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import type { DailyMetric } from "@/lib/types";
import { fetchTopAddonsForRollupDocs, type AddonAgg } from "@/lib/analytics/top-addons";

function fmtCurrency(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `₱${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface TopAddonItemsCardProps {
  storeId: string;
  dailyMetrics: DailyMetric[];
  isLoading: boolean;
  topN?: number;
}

export function TopAddonItemsCard({ storeId, dailyMetrics, isLoading, topN = 10 }: TopAddonItemsCardProps) {
  const [items, setItems] = useState<AddonAgg[]>([]);
  const [isLoadingTop, setIsLoadingTop] = useState(false);

  const totalAddonSales = useMemo(() => {
    // uses small category map from dailyMetrics (cheap)
    let total = 0;
    (dailyMetrics || []).forEach((m) => {
      const byCat = m?.sales?.addonSalesAmountByCategory ?? {};
      for (const v of Object.values(byCat)) total += Number(v ?? 0);
    });
    return total;
  }, [dailyMetrics]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!storeId || !dailyMetrics || dailyMetrics.length === 0) {
        setItems([]);
        return;
      }
      setIsLoadingTop(true);
      try {
        const dayRefs = dailyMetrics
          .map((m) => m?.meta?.dayId)
          .filter(Boolean)
          .map((dayId) => doc(db, "stores", storeId, "analytics", dayId as string));

        const top = await fetchTopAddonsForRollupDocs(db, dayRefs, topN);
        if (!cancelled) setItems(top);
      } catch (e) {
        console.error("Error loading top add-ons:", e);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setIsLoadingTop(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [storeId, dailyMetrics, topN]);

  const loading = isLoading || isLoadingTop;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Top Add-ons (Items)</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No add-on data for this range.</div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              Total add-on sales (by category):{" "}
              <span className="font-medium text-foreground">{fmtCurrency(totalAddonSales)}</span>
            </div>

            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={`${it.itemName}-${idx}`} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{it.itemName}</div>
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
