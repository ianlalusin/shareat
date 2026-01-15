
"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, orderBy, query, where, getDocs, collection } from "firebase/firestore";
import { db } from "@/lib/firebase/client"; 
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { fetchTopRefillsForRollupDocs } from "@/lib/analytics/top-refills";
import type { DailyMetric } from "@/lib/types";

type TopRefillRow = { refillName: string; qty: number };

interface TopRefillsCardProps {
  dailyMetrics?: DailyMetric[];
  isLoading: boolean;
  topN?: number;
}

export function TopRefillsCard({ dailyMetrics, isLoading, topN = 5 }: TopRefillsCardProps) {
  
  const topRefills = useMemo(() => {
    if (!dailyMetrics) return [];

    const merged: Record<string, number> = {};
    
    dailyMetrics.forEach(metric => {
      const byName = metric.refills?.servedRefillsByName ?? {};
      for (const [name, count] of Object.entries(byName)) {
        merged[name] = (merged[name] || 0) + count;
      }
    });

    return Object.entries(merged)
      .map(([refillName, qty]) => ({ refillName, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, topN);

  }, [dailyMetrics, topN]);


  const totalRefillsInRange = useMemo(() => {
    if (!dailyMetrics) return 0;
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
