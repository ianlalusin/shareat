"use client";

import { useEffect, useState } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { format, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ForecastModelPanel } from "@/components/dashboard/ForecastModelPanel";

interface ForecastAccuracyTrendCardProps {
  storeId?: string;
  // Today's forecast (folded in from the former TodayForecastCard).
  projectedSales?: number | null;
  actualSalesToday?: number | null;
  confidence?: string | null;
  drivers?: string[] | null;
  modelSales?: number | null;
  engine?: "llm" | "model" | null;
  isForecastLoading?: boolean;
  isAdmin?: boolean;
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
}

function accuracyColor(pct: number): string {
  if (pct >= 85) return "hsl(142, 76%, 36%)"; // green
  if (pct >= 70) return "hsl(38, 92%, 50%)";  // amber
  return "hsl(0, 84%, 60%)";                   // red
}

function formatCurrency(value: number) {
  if (value >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `₱${(value / 1_000).toFixed(1)}k`;
  return `₱${value.toFixed(0)}`;
}

function getTimeOfDayFraction(): number {
  const now = new Date();
  const openHour = 10;
  const closeHour = 22;
  const currentHour = now.getHours() + now.getMinutes() / 60;
  if (currentHour <= openHour) return 0;
  if (currentHour >= closeHour) return 1;
  return (currentHour - openHour) / (closeHour - openHour);
}

function getPacingLabel(actual: number, projected: number, timeFraction: number): { label: string; color: string } {
  if (timeFraction <= 0 || projected <= 0) return { label: "", color: "" };
  const expectedSoFar = projected * timeFraction;
  const ratio = actual / expectedSoFar;
  if (ratio >= 1.1) return { label: "Ahead", color: "text-green-600" };
  if (ratio >= 0.9) return { label: "On track", color: "text-blue-600" };
  return { label: "Behind", color: "text-amber-600" };
}

function confidenceBadge(confidence?: string | null) {
  if (!confidence) return null;
  const variant = confidence === "high" ? "default" : confidence === "low" ? "destructive" : "secondary";
  return (
    <Badge variant={variant} className="text-[10px] px-1.5 py-0">
      {confidence}
    </Badge>
  );
}

// Today's forecast progress: actual [====progress====] target.
function TodayForecastRow({ projectedSales, actualSalesToday, isForecastLoading }: {
  projectedSales?: number | null;
  actualSalesToday?: number | null;
  isForecastLoading?: boolean;
}) {
  if (isForecastLoading) {
    return (
      <div className="mt-4 border-t pt-3 flex items-center justify-center h-12">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (projectedSales == null || projectedSales <= 0) {
    return (
      <div className="mt-4 border-t pt-3">
        <p className="text-xs text-muted-foreground">Today&apos;s Forecast</p>
        <p className="text-sm text-muted-foreground">No forecast available for today.</p>
      </div>
    );
  }
  const actual = actualSalesToday ?? 0;
  const timeFraction = getTimeOfDayFraction();
  const pacing = getPacingLabel(actual, projectedSales, timeFraction);
  const progressPct = Math.min(100, Math.round((actual / projectedSales) * 100));
  return (
    <div className="mt-4 border-t pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Today&apos;s Forecast</p>
        {pacing.label && <span className={cn("text-xs font-semibold", pacing.color)}>{pacing.label}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="shrink-0 text-xs font-mono font-medium tabular-nums text-foreground" title="Actual today">
          {formatCurrency(actual)}
        </span>
        <Progress value={progressPct} className="h-2 flex-1" />
        <span className="shrink-0 text-xs font-mono tabular-nums text-muted-foreground" title="Target (projected)">
          {formatCurrency(projectedSales)}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground text-center">{progressPct}% of forecast</p>
    </div>
  );
}

export function ForecastAccuracyTrendCard({
  storeId,
  projectedSales,
  actualSalesToday,
  confidence,
  drivers,
  modelSales,
  engine,
  isForecastLoading,
  isAdmin,
  onRefresh,
  isRefreshing,
}: ForecastAccuracyTrendCardProps) {
  const [data, setData] = useState<{ date: string; accuracy: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!storeId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const fourteenDaysAgo = format(subDays(new Date(), 14), "yyyy-MM-dd");
    const q = query(
      collection(db, "stores", storeId, "salesForecasts"),
      where("accuracy", ">=", 0),
      where("date", ">=", fourteenDaysAgo),
      orderBy("date", "asc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => {
        const doc = d.data();
        return {
          date: doc.date as string,
          accuracy: Math.round((doc.accuracy as number) * 100),
        };
      });
      setData(rows);
      setIsLoading(false);
    }, (err) => {
      console.error("Accuracy trend fetch failed:", err);
      setIsLoading(false);
    });

    return () => unsub();
  }, [storeId]);

  const avgAccuracy = data.length > 0
    ? Math.round(data.reduce((s, d) => s + d.accuracy, 0) / data.length)
    : null;

  const avgColor = avgAccuracy !== null
    ? avgAccuracy >= 85 ? "text-green-600" : avgAccuracy >= 70 ? "text-amber-600" : "text-red-600"
    : "text-muted-foreground";

  const chartConfig = {
    accuracy: { label: "Accuracy", color: "hsl(var(--primary))" },
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp />
          Forecast Accuracy
          {confidenceBadge(confidence)}
          {isAdmin && onRefresh && (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-7 w-7"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh forecast"
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            </Button>
          )}
        </CardTitle>
        <CardDescription>Last 14 days — forecast vs. actual sales.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-[180px]">
            <Loader2 className="animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <p className="text-center text-muted-foreground pt-4">
            Not enough data to show accuracy trend yet.
          </p>
        ) : (
          <>
            <div className="text-center mb-3">
              <span className="text-sm text-muted-foreground">Average: </span>
              <span className={cn("text-2xl font-bold", avgColor)}>
                {avgAccuracy}%
              </span>
            </div>
            <ChartContainer config={chartConfig} className="h-[150px] w-full">
              <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => format(new Date(d), "M/d")}
                  tick={{ fontSize: 11 }}
                />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload?.[0]) {
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border bg-background p-2 text-sm shadow-sm">
                          <div className="font-bold">{d.date}</div>
                          <div className="font-mono">{d.accuracy}%</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                {avgAccuracy !== null && (
                  <ReferenceLine y={avgAccuracy} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                )}
                <Bar dataKey="accuracy" radius={[3, 3, 0, 0]}>
                  {data.map((entry, index) => (
                    <Cell key={index} fill={accuracyColor(entry.accuracy)} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </>
        )}

        <TodayForecastRow
          projectedSales={projectedSales}
          actualSalesToday={actualSalesToday}
          isForecastLoading={isForecastLoading}
        />
        <ForecastModelPanel storeId={storeId} drivers={drivers} modelSales={modelSales} engine={engine} />
      </CardContent>
    </Card>
  );
}
