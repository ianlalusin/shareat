
// src/components/dashboard/top-refills-card.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import type { DailyMetric } from "@/lib/types";
import { fetchTopRefillsForRollupDocs } from "@/lib/analytics/top-refills";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

type TopRefillRow = { refillName: string; qty: number };

interface TopRefillsCardProps {
  storeId: string;
  dateRange?: { start: Date; end: Date }; // Make optional
  topN?: number;
  dailyMetrics?: DailyMetric[];
  isLoading: boolean;
}

export function TopRefillsCard({ storeId, dateRange, topN = 5, dailyMetrics, isLoading: isLoadingProp }: TopRefillsCardProps) {
  const [localDailyMetrics, setLocalDailyMetrics] = useState<DailyMetric[]>([]);
  const [isLoadingLocal, setIsLoadingLocal] = useState(!dailyMetrics);
  const [topRefills, setTopRefills] = useState<TopRefillRow[]>([]);
  
  const metrics = dailyMetrics ?? localDailyMetrics;
  const isLoading = isLoadingProp || isLoadingLocal;

  useEffect(() => {
    if (dailyMetrics) {
      setIsLoadingLocal(false);
      setLocalDailyMetrics([]);
      return;
    }
    
    if (!storeId || !dateRange) {
        setIsLoadingLocal(false);
        return;
    }

    const startDayId = getDayIdFromTimestamp(dateRange.start);
    const endDayId = getDayIdFromTimestamp(dateRange.end);
    const q = query(
      collection(db, "stores", storeId, "analytics"),
      where("meta.dayId", ">=", startDayId),
      where("meta.dayId", "<=", endDayId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        setLocalDailyMetrics(snapshot.docs.map(doc => doc.data() as DailyMetric));
        setIsLoadingLocal(false);
    }, (error) => {
        console.error("Error fetching daily metrics for TopRefillsCard:", error);
        setIsLoadingLocal(false);
    });

    return () => unsubscribe();
  }, [storeId, dateRange, dailyMetrics]);
  
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!storeId) return;
      setIsLoadingLocal(true);
      try {
        const dayRefs = (metrics || [])
          .map((m) => m?.meta?.dayId)
          .filter(Boolean)
          .map((dayId) => doc(db, "stores", storeId, "analytics", dayId as string));

        const items = await fetchTopRefillsForRollupDocs(db, dayRefs, topN);
        if (!cancelled) setTopRefills(items as TopRefillRow[]);
      } finally {
        if (!cancelled) setIsLoadingLocal(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [storeId, topN, metrics]);

  const totalRefillsInRange = useMemo(() => {
    return (metrics || []).reduce((sum, m) => sum + (m?.refills?.servedRefillsTotal ?? 0), 0);
  }, [metrics]);


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
          </div>
        ) : topRefills.length === 0 ? (
          <div className="text-sm text-center text-muted-foreground">No refill data for this range.</div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground text-center">
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
