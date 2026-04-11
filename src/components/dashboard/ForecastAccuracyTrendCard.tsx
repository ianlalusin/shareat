"use client";

import { useEffect, useState } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { format, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Loader2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ForecastAccuracyTrendCardProps {
  storeId?: string;
}

function accuracyColor(pct: number): string {
  if (pct >= 85) return "hsl(142, 76%, 36%)"; // green
  if (pct >= 70) return "hsl(38, 92%, 50%)";  // amber
  return "hsl(0, 84%, 60%)";                   // red
}

export function ForecastAccuracyTrendCard({ storeId }: ForecastAccuracyTrendCardProps) {
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp />
          Forecast Accuracy
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
      </CardContent>
    </Card>
  );
}
