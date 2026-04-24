"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyMetric } from "@/lib/types";
import Link from "next/link";

function fmtCurrency(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `₱${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface DiscountsChargesCardProps {
  dailyMetrics: DailyMetric[];
  isLoading: boolean;
}

export function DiscountsChargesCard({ dailyMetrics, isLoading }: DiscountsChargesCardProps) {
  const { totalDiscounts, totalCharges } = useMemo(() => {
    let discounts = 0;
    let charges = 0;
    dailyMetrics.forEach((metric) => {
      discounts += metric.payments?.discountsTotal ?? 0;
      charges += metric.payments?.chargesTotal ?? 0;
    });
    return { totalDiscounts: discounts, totalCharges: charges };
  }, [dailyMetrics]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Discounts &amp; Charges</CardTitle>
          <CardDescription className="text-center">Receipt-level totals (line + order discounts).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Link href="/logs">
      <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Discounts &amp; Charges</CardTitle>
          <CardDescription className="text-center">Receipt-level totals (line + order discounts).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="truncate text-sm text-destructive">Discounts</div>
            <div className="shrink-0 text-sm font-medium tabular-nums text-destructive">
              - {fmtCurrency(totalDiscounts)}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="truncate text-sm text-green-600">Charges</div>
            <div className="shrink-0 text-sm font-medium tabular-nums text-green-600">
              + {fmtCurrency(totalCharges)}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
