// src/components/dashboard/avg-refills-card.tsx
"use client";

import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

import type { DailyMetric } from "@/lib/types";

interface AvgRefillsCardProps {
  storeId: string;
  dateRange: { start: Date; end: Date };
  dailyMetrics?: DailyMetric[];
  isLoading: boolean;
}

export function AvgRefillsCard({ storeId, dateRange, dailyMetrics, isLoading: isLoadingProp }: AvgRefillsCardProps) {
  const [localDailyMetrics, setLocalDailyMetrics] = useState<DailyMetric[]>([]);
  const [isLoadingLocal, setIsLoadingLocal] = useState(!dailyMetrics);

  useEffect(() => {
    if (dailyMetrics) {
      setIsLoadingLocal(false);
      return;
    }
    
    if(!storeId) {
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
        console.error("Error fetching daily metrics for AvgRefillsCard:", error);
        setIsLoadingLocal(false);
    });

    return () => unsubscribe();
  }, [storeId, dateRange, dailyMetrics]);

  const metrics = dailyMetrics ?? localDailyMetrics;
  const isLoading = isLoadingProp || isLoadingLocal;

  const analytics = useMemo(() => {
    let sessionCount = 0;
    let overallTotal = 0;

    (metrics || []).forEach((m) => {
      sessionCount += m?.refills?.packageSessionsCount ?? 0;
      overallTotal += m?.refills?.servedRefillsTotal ?? 0;
    });

    const avg = sessionCount > 0 ? overallTotal / sessionCount : 0;

    return {
      sessionCount,
      overallTotal,
      avg,
    };
  }, [metrics]);


  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Average Refills</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : (
          <>
            <div className="text-2xl font-semibold tabular-nums">
              {analytics.avg.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-muted-foreground">
              Total refills served:{" "}
              <span className="font-medium text-foreground">
                {analytics.overallTotal.toLocaleString("en-US")}
              </span>{" "}
              • Package sessions:{" "}
              <span className="font-medium text-foreground">
                {analytics.sessionCount.toLocaleString("en-US")}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
