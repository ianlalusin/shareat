// src/components/dashboard/avg-refills-card.tsx
"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import type { DailyMetric } from "@/lib/analytics/types"; // adjust path if yours differs

interface AvgRefillsCardProps {
  dailyMetrics: DailyMetric[];
  isLoading: boolean;
}

export function AvgRefillsCard({ dailyMetrics, isLoading }: AvgRefillsCardProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const analytics = useMemo(() => {
    let sessionCount = 0;
    let overallTotal = 0;

    (dailyMetrics || []).forEach((m) => {
      sessionCount += m?.refills?.packageSessionsCount ?? 0;
      overallTotal += m?.refills?.servedRefillsTotal ?? 0;
    });

    const avg = sessionCount > 0 ? overallTotal / sessionCount : 0;

    return {
      sessionCount,
      overallTotal,
      avg,
    };
  }, [dailyMetrics]);

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

            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="secondary" size="sm" disabled={isLoading}>
                  Details
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-lg">
                <SheetHeader>
                  <SheetTitle>Refill Summary</SheetTitle>
                </SheetHeader>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Average refills / package session</span>
                    <span className="font-medium tabular-nums">
                      {analytics.avg.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total refills served</span>
                    <span className="font-medium tabular-nums">
                      {analytics.overallTotal.toLocaleString("en-US")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Package sessions counted</span>
                    <span className="font-medium tabular-nums">
                      {analytics.sessionCount.toLocaleString("en-US")}
                    </span>
                  </div>

                  <div className="pt-2 text-xs text-muted-foreground">
                    Per-refill breakdown moved to the <span className="font-medium text-foreground">Top Refills</span>{" "}
                    card (from refillItems rollup).
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </>
        )}
      </CardContent>
    </Card>
  );
}
