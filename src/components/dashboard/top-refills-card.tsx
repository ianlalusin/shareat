// src/components/dashboard/top-refills-card.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { doc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import type { DailyMetric } from "@/lib/analytics/types"; // adjust path if yours differs
import { fetchTopRefillsForRollupDocs } from "@/lib/analytics/top-refills";

type TopRefillRow = { refillName: string; qty: number };

interface TopRefillsCardProps {
  storeId: string;
  dailyMetrics: DailyMetric[];
  isLoading: boolean;
  topN?: number;
}

export function TopRefillsCard({ storeId, dailyMetrics, isLoading, topN = 5 }: TopRefillsCardProps) {
  const [topRefills, setTopRefills] = useState<TopRefillRow[]>([]);
  const [isLoadingTop, setIsLoadingTop] = useState(false);

  const totalRefillsInRange = useMemo(() => {
    return (dailyMetrics || []).reduce((sum, m) => sum + (m?.refills?.servedRefillsTotal ?? 0), 0);
  }, [dailyMetrics]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!storeId || !dailyMetrics || dailyMetrics.length === 0) {
        setTopRefills([]);
        return;
      }

      setIsLoadingTop(true);
      try {
        const dayRefs = dailyMetrics
          .map((m) => m?.meta?.dayId)
          .filter(Boolean)
          .map((dayId) => doc(db, "stores", storeId, "analytics", dayId as string));

        const items = await fetchTopRefillsForRollupDocs(db, dayRefs, topN);
        if (!cancelled) setTopRefills(items as TopRefillRow[]);
      } catch (e) {
        console.error("Error loading top refills:", e);
        if (!cancelled) setTopRefills([]);
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
        <CardTitle className="text-base">Top Refills</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
          </div>
        ) : topRefills.length === 0 ? (
          <div className="text-sm text-muted-foreground">No refill data for this range.</div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              Total refills served:{" "}
              <span className="font-medium text-foreground">
                {totalRefillsInRange.toLocaleString("en-US")}
              </span>
            </div>

            <div className="space-y-2">
              {topRefills.map((r, idx) => (
                <div key={`${r.refillName}-${idx}`} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{r.refillName}</div>
                  </div>
                  <div className="shrink-0 text-sm font-medium tabular-nums">
                    {Number(r.qty || 0).toLocaleString("en-US")}
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
