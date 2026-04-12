
"use client";

import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { collection, query, where, orderBy, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { addDays, format } from "date-fns";
import { Loader2, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useStoreContext } from "@/context/store-context";
import type { DailyMetric } from "@/lib/types";

interface WeeklySalesChartProps {
  storeId: string;
}

type ChartRow = {
  name: string;
  date: string;
  past: number | null;
  forecast: number | null;
  isToday: boolean;
  onTrack: boolean;
};

function formatCurrency(value: number) {
  if (value >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `₱${(value / 1_000).toFixed(1)}k`;
  return `₱${value.toFixed(0)}`;
}

function atStartOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getDayProgress(): number {
  const now = new Date();
  const openHour = 10;
  const closeHour = 22;
  const currentHour = now.getHours() + now.getMinutes() / 60;
  if (currentHour <= openHour) return 0;
  if (currentHour >= closeHour) return 1;
  return (currentHour - openHour) / (closeHour - openHour);
}

function TodayDot(props: any) {
  const { cx, cy, payload } = props;
  if (!payload?.isToday) return null;
  const color = payload.onTrack ? "#16a34a" : "#dc2626";
  return (
    <g>
      <circle cx={cx} cy={cy} r="6" fill={color}>
        <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r="12" fill={color} opacity="0.3">
        <animate attributeName="r" values="6;14;6" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0;0.5" dur="1.5s" repeatCount="indefinite" />
      </circle>
    </g>
  );
}

export function WeeklySalesChart({ storeId }: WeeklySalesChartProps) {
  const { activeStore } = useStoreContext();
  const [data, setData] = useState<ChartRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!storeId || !activeStore) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);

      try {
        const today = new Date();
        const windowStart = atStartOfDay(addDays(today, -3));
        const windowEnd = atStartOfDay(addDays(today, 3));
        const todayDayId = format(today, "yyyyMMdd");
        const todayStr = format(today, "yyyy-MM-dd");

        // Past 3 days + today — read from analytics
        const salesQuery = query(
          collection(db, "stores", storeId, "analytics"),
          where("meta.dayStartMs", ">=", windowStart.getTime()),
          where("meta.dayStartMs", "<=", atStartOfDay(today).getTime()),
          orderBy("meta.dayStartMs", "asc")
        );

        // Today + next 3 days — read from stored forecasts
        const forecastQuery = query(
          collection(db, "stores", storeId, "salesForecasts"),
          where("date", ">=", todayStr),
          where("date", "<=", format(windowEnd, "yyyy-MM-dd")),
          orderBy("date", "asc")
        );

        const todayAnalyticsDocRef = doc(db, "stores", storeId, "analytics", todayDayId);

        const [salesSnap, forecastSnap, todayAnalyticsSnap] = await Promise.all([
          getDocs(salesQuery),
          getDocs(forecastQuery),
          getDoc(todayAnalyticsDocRef),
        ]);

        const todayLiveSales = todayAnalyticsSnap.exists()
          ? (todayAnalyticsSnap.data() as DailyMetric).payments?.totalGross ?? 0
          : 0;

        const salesByDate = new Map<string, number>();
        salesSnap.docs.forEach(d => {
          const data = d.data();
          salesByDate.set(format(new Date(data.meta.dayStartMs), "yyyy-MM-dd"), data.payments?.totalGross ?? 0);
        });
        // Override today with live value
        salesByDate.set(todayStr, todayLiveSales);

        const forecastByDate = new Map<string, number>();
        forecastSnap.docs.forEach(d => {
          const data = d.data();
          forecastByDate.set(data.date, data.projectedSales ?? 0);
        });

        const todayForecast = forecastByDate.get(todayStr) ?? 0;
        const dayProgress = getDayProgress();
        const expectedSoFar = todayForecast * dayProgress;
        const onTrack = todayForecast === 0 || todayLiveSales >= expectedSoFar * 0.9;

        const chartData: ChartRow[] = [];
        for (let offset = -3; offset <= 3; offset++) {
          const d = addDays(today, offset);
          const dateStr = format(d, "yyyy-MM-dd");
          const label = format(d, "E M/d");
          const isToday = offset === 0;

          let past: number | null = null;
          let forecast: number | null = null;

          if (offset < 0) {
            past = salesByDate.get(dateStr) ?? 0;
          } else if (offset === 0) {
            past = todayLiveSales;
            forecast = todayForecast;
          } else {
            forecast = forecastByDate.get(dateStr) ?? 0;
          }

          chartData.push({ name: label, date: dateStr, past, forecast, isToday, onTrack });
        }

        setData(chartData);
      } catch (err: any) {
        console.error("[WeeklySalesChart] failed:", err);
        setError(err.message || "Failed to load sales chart.");
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [storeId, activeStore]);

  const todayRow = data.find(d => d.isToday);
  const pacingLabel = todayRow ? (todayRow.onTrack ? "On pace" : "Behind") : null;
  const pacingColor = todayRow?.onTrack ? "text-green-600" : "text-red-600";

  const chartConfig = {
    past: { label: "Actual", color: "#dc2626" },
    forecast: { label: "Projection", color: "#dc2626" },
  };

  const hasAnyForecast = data.some(d => d.forecast !== null && d.forecast > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles />
          Weekly Sales
          {pacingLabel && (
            <span className={`ml-auto text-sm font-semibold ${pacingColor}`}>
              {pacingLabel}
            </span>
          )}
        </CardTitle>
        <CardDescription>
          3 days past · today · 3 days projection. Today pulses{" "}
          <span className="text-red-600 font-semibold">red</span> when behind,{" "}
          <span className="text-green-600 font-semibold">green</span> when on pace.
          <span className="text-xs text-muted-foreground/80"> (AI forecast updated daily at noon)</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[300px] flex items-center justify-center">
            <Loader2 className="animate-spin" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Chart Unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : !hasAnyForecast ? (
          <Alert>
            <AlertTitle>Forecast not yet available</AlertTitle>
            <AlertDescription>Forecasts are generated once daily at noon. Check back after 12:00 PM.</AlertDescription>
          </Alert>
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <LineChart data={data} margin={{ top: 20, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(value) => formatCurrency(value)} tick={{ fontSize: 11 }} />
              <Tooltip
                cursor={false}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const row = payload[0].payload as ChartRow;
                    const value = row.past ?? row.forecast ?? 0;
                    const label = row.isToday ? "Today (live)" : row.past !== null ? "Actual" : "Projection";
                    return (
                      <div className="rounded-lg border bg-background p-2 text-sm shadow-sm">
                        <div className="font-bold">{row.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-muted-foreground">{label}:</span>
                          <span className="font-mono font-medium">{formatCurrency(value)}</span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Line
                type="monotone"
                dataKey="past"
                stroke="#dc2626"
                strokeWidth={2.5}
                connectNulls={false}
                dot={(props: any) => {
                  if (props.payload?.isToday) return <TodayDot key={props.index} {...props} />;
                  return <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill="#dc2626" />;
                }}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="forecast"
                stroke="#dc2626"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                connectNulls={false}
                dot={(props: any) => {
                  if (props.payload?.isToday) return <g key={props.index} />;
                  return <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill="#dc2626" opacity={0.6} />;
                }}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
