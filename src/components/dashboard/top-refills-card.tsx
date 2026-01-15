
"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client"; 
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { fetchTopRefillsForRollupDocs } from "@/lib/analytics/top-refills";
import type { DailyMetric } from "@/lib/types";

type TopRefillRow = { refillName: string; qty: number };

interface TopRefillsCardProps {
  storeId: string;
  dateRange: { start: Date; end: Date };
  topN?: number;
}

export function TopRefillsCard({ storeId, dateRange, topN = 5 }: TopRefillsCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [topRefills, setTopRefills] = useState<TopRefillRow[]>([]);
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);

  useEffect(() => {
    if (!storeId) {
      setIsLoading(false);
      setDailyMetrics([]);
      setTopRefills([]);
      return;
    }

    setIsLoading(true);

    const startMs = dateRange.start.getTime();
    const endMs = dateRange.end.getTime();

    const metricsRef = collection(db, "stores", storeId, "analytics");
    const q = query(
      metricsRef,
      where("meta.dayStartMs", ">=", startMs),
      where("meta.dayStartMs", "<=", endMs),
      orderBy("meta.dayStartMs", "asc")
    );

    let cancelled = false;

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        try {
          const fetched = snapshot.docs.map((d) => d.data() as DailyMetric);
          if (cancelled) return;
          setDailyMetrics(fetched);

          const dayRefs = fetched
            .map((m) => m?.meta?.dayId)
            .filter(Boolean)
            .map((dayId) => doc(db, "stores", storeId, "analytics", dayId as string));

          const items = await fetchTopRefillsForRollupDocs(db, dayRefs, 10);
          if (cancelled) return;
          setTopRefills(items as TopRefillRow[]);
        } catch (err) {
          console.error("Error fetching top refills:", err);
          if (!cancelled) setTopRefills([]);
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      },
      (error) => {
        console.error("Error fetching refill analytics:", error);
        if (!cancelled) setIsLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [storeId, dateRange, topN]);

  const totalRefillsInRange = useMemo(() => {
    return dailyMetrics.reduce((sum, m) => sum + (m?.refills?.servedRefillsTotal ?? 0), 0);
  }, [dailyMetrics]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Top Refills</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
            <Skeleton className="h-4 w-9/12" />
          </div>
        ) : topRefills.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No refill data for this range.
          </div>
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
                <div
                  key={`${r.refillName}-${idx}`}
                  className="flex items-center justify-between gap-3"
                >
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
