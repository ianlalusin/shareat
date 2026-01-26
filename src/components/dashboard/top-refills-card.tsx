

// src/components/dashboard/top-refills-card.tsx
"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyMetric, TopRefillRow } from "@/lib/types";

interface TopRefillsCardProps {
  topRefills: TopRefillRow[];
  dailyMetrics: DailyMetric[];
  isLoading: boolean;
}

export function TopRefillsCard({ topRefills, dailyMetrics, isLoading }: TopRefillsCardProps) {
  
  const totalRefillsInRange = useMemo(() => {
    return (dailyMetrics || []).reduce((sum, m) => sum + (m?.refills?.servedRefillsTotal ?? 0), 0);
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
                <div key={`${r.name}-${idx}`} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{r.name}</div>
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
