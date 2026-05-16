"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber } from "./formatters";
import type { DataAnalysisResult } from "@/hooks/use-data-analysis";

export function KpiStrip({ totals, isLoading }: { totals: DataAnalysisResult["totals"]; isLoading: boolean }) {
  const items = [
    { label: "Net Sales", value: formatCurrency(totals.netSales) },
    { label: "Transactions", value: formatNumber(totals.txCount) },
    { label: "Dine-In Sessions", value: formatNumber(totals.dineInSessions) },
    { label: "Walk-In Sessions", value: formatNumber(totals.walkInSessions) },
    { label: "Guests Served", value: formatNumber(totals.totalGuests) },
    { label: "Avg Basket", value: formatCurrency(totals.avgBasket) },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{it.label}</div>
            {isLoading ? (
              <Skeleton className="h-7 w-24 mt-2" />
            ) : (
              <div className="text-2xl font-semibold tabular-nums mt-1">{it.value}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
