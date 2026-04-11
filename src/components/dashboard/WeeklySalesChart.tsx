
"use client";

import { useState, useEffect, useMemo } from "react";
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { collection, query, where, orderBy, getDocs, doc, getDoc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase/client";
import { addDays, format } from "date-fns";
import type { ForecastInput } from "@/ai/flows/forecast-weekly-sales";
import { Loader2, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useStoreContext } from "@/context/store-context";
import type { DailyContext, WeatherRecord, DailyMetric } from "@/lib/types";
import { getUpcomingPayrollDates, getUpcomingHolidays, computeDayOfWeekAverages, computeTrendDirection } from "@/lib/utils/forecast-helpers";

// --- Caching Constants ---
const CACHE_KEY_PREFIX = 'weeklySalesChartData';
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

interface WeeklySalesChartProps {
  storeId: string;
}

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

// Confidence → band width multiplier
function confidenceBandPct(confidence?: string): number {
  if (confidence === "high") return 0.05;
  if (confidence === "low") return 0.25;
  return 0.15; // medium or unknown
}

export function WeeklySalesChart({ storeId }: WeeklySalesChartProps) {
  const { activeStore } = useStoreContext();
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDataAndForecast() {
      if (!storeId || !activeStore) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);

      const cacheKey = `${CACHE_KEY_PREFIX}:${storeId}`;
      try {
        const cachedItem = localStorage.getItem(cacheKey);
        if (cachedItem) {
          const { timestamp, data: cachedData } = JSON.parse(cachedItem);
          if (Date.now() - timestamp < CACHE_TTL) {
            setData(cachedData);
            setIsLoading(false);
            return;
          }
        }
      } catch (e) {
        console.warn("Could not read weekly sales cache:", e);
      }

      try {
        const today = new Date();
        const endDate = atStartOfDay(today);
        const startDate = addDays(endDate, -27);
        const todayDayId = format(today, "yyyyMMdd");

        const salesQuery = query(
          collection(db, "stores", storeId, "analytics"),
          where("meta.dayStartMs", ">=", startDate.getTime()),
          where("meta.dayStartMs", "<=", endDate.getTime()),
          orderBy("meta.dayStartMs", "asc")
        );
        const weatherQuery = collection(db, "stores", storeId, "weatherRecords");
        const todayAnalyticsDocRef = doc(db, "stores", storeId, "analytics", todayDayId);

        const dailyContextQuery = query(
          collection(db, "stores", storeId, "dailyContext"),
          where("dayId", ">=", format(startDate, "yyyyMMdd")),
          where("dayId", "<=", todayDayId)
        );

        const [salesSnapshot, weatherSnapshot, todayAnalyticsSnap, dailyContextSnapshot] = await Promise.all([
            getDocs(salesQuery),
            getDocs(query(weatherQuery, where("dayId", ">=", format(startDate, "yyyyMMdd")), where("dayId", "<=", format(endDate, "yyyyMMdd")))),
            getDoc(todayAnalyticsDocRef),
            getDocs(dailyContextQuery),
        ]);

        const todayLiveSales = todayAnalyticsSnap.exists() ? (todayAnalyticsSnap.data() as DailyMetric).payments?.totalGross ?? 0 : 0;

        const historicalSales = salesSnapshot.docs.map((doc) => {
          const data = doc.data();
          const dayId = data.meta.dayId;
          const netSales = data.payments?.totalGross || 0;

          if (dayId === todayDayId) {
              return {
                  date: format(new Date(data.meta.dayStartMs), "yyyy-MM-dd"),
                  netSales: todayLiveSales,
              };
          }

          return {
            date: format(new Date(data.meta.dayStartMs), "yyyy-MM-dd"),
            netSales: netSales,
          };
        });

        const hasTodayData = historicalSales.some(s => s.date === format(today, 'yyyy-MM-dd'));
        if (!hasTodayData && todayLiveSales > 0) {
            historicalSales.push({
                date: format(today, 'yyyy-MM-dd'),
                netSales: todayLiveSales,
            });
        }

        const historicalWeather = weatherSnapshot.docs.map(d => {
            const data = d.data() as WeatherRecord;
            const conditions = data.entries.map(e => e.condition);
            const conditionCounts = conditions.reduce((acc, cond) => {
                acc[cond] = (acc[cond] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            const summary = Object.keys(conditionCounts).sort((a,b) => conditionCounts[b] - conditionCounts[a])[0] || 'clear';

            return {
                date: format(new Date(data.dayId.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')), "yyyy-MM-dd"),
                condition: summary.replace('_', ' '),
            }
        });

        if (historicalSales.length < 7) {
          setData([]);
          setIsLoading(false);
          return;
        }

        // Enrich with daily context
        const dailyContextDocs = dailyContextSnapshot.docs.map(d => d.data() as DailyContext);
        const loggedHolidays = dailyContextDocs
          .filter(dc => dc.holiday && dc.holiday.name !== "None")
          .map(dc => {
            const dateStr = dc.dayId.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
            return `${dc.holiday!.name} on ${dateStr}`;
          });
        const todayContext = dailyContextDocs.find(dc => dc.dayId === todayDayId);

        // Use shared helpers with store's forecast config
        const config = activeStore.forecastConfig;
        const upcomingPayrollDates = getUpcomingPayrollDates(config);
        const configHolidays = getUpcomingHolidays(config).map(h => `${h.name} on ${h.date}`);
        const upcomingHolidays = [...new Set([...configHolidays, ...loggedHolidays])];
        const dayOfWeekAverages = computeDayOfWeekAverages(historicalSales);
        const { direction: trendDirection, ratio: recentVsHistoricalRatio } = computeTrendDirection(historicalSales);

        const forecastInput: ForecastInput = {
          historicalSales,
          historicalWeather,
          storeLocation: activeStore.address,
          upcomingPayrollDates,
          upcomingHolidays,
          dayOfWeekAverages,
          trendDirection,
          recentVsHistoricalRatio,
          storeContext: [
            config?.storeContext,
            todayContext?.isPayday?.value ? "Today is confirmed as a payday by staff." : undefined,
            todayContext?.holiday && todayContext.holiday.name !== "None"
              ? `Today is ${todayContext.holiday.name} (confirmed by staff).`
              : undefined,
          ].filter(Boolean).join(" ") || undefined,
        };

        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Not authenticated");

        const res = await fetch('/api/forecast-weekly-sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(forecastInput),
        });

        if (!res.ok) {
          const errorJson = await res.json().catch(() => ({ error: "Failed to parse error response." }));
          throw new Error(errorJson.error || "Failed to fetch forecast.");
        }

        const forecastResult = await res.json();

        const salesByDate = new Map(historicalSales.map(s => [s.date, s.netSales]));
        const forecastByDay = new Map<string, { sales: number; confidence?: string }>(
          forecastResult.forecast.map((f: any) => [f.day, { sales: f.forecastedSales, confidence: f.confidence }])
        );

        const chartData = [];

        for (let i = 6; i >= 0; i--) {
            const currentDay = addDays(today, -i);
            const lastWeekDay = addDays(currentDay, -7);

            chartData.push({
                name: format(currentDay, 'E'),
                thisWeek: salesByDate.get(format(currentDay, "yyyy-MM-dd")) ?? 0,
                lastWeek: salesByDate.get(format(lastWeekDay, "yyyy-MM-dd")) ?? 0,
                forecast: 0,
                forecastRange: [0, 0] as [number, number],
            });
        }

        for (let i = 1; i <= 7; i++) {
            const forecastDay = addDays(today, i);
            const dayName = format(forecastDay, 'EEEE');
            const dayAbbr = format(forecastDay, 'E');

            const fData = forecastByDay.get(dayName);
            const forecastVal = fData?.sales ?? 0;
            const bandPct = confidenceBandPct(fData?.confidence);
            const lower = Math.round(forecastVal * (1 - bandPct));
            const upper = Math.round(forecastVal * (1 + bandPct));

            const existingIndex = chartData.findIndex(d => d.name === dayAbbr);
            if (existingIndex !== -1) {
                chartData[existingIndex].forecast = forecastVal;
                chartData[existingIndex].forecastRange = [lower, upper];
            } else {
                 chartData.push({
                    name: dayAbbr,
                    thisWeek: 0,
                    lastWeek: 0,
                    forecast: forecastVal,
                    forecastRange: [lower, upper],
                });
            }
        }
        const finalChartData = chartData.slice(chartData.length - 7);

        setData(finalChartData);

        try {
            localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: finalChartData }));
        } catch(e) {
            console.warn("Could not write to weekly sales cache:", e);
        }

      } catch (err: any) {
        console.error("[SalesForecast] failed:", err);
        setError(err.message || "Failed to generate sales forecast.");
      } finally {
        setIsLoading(false);
      }
    }

    fetchDataAndForecast();
  }, [storeId, activeStore]);

  const chartConfig = {
      thisWeek: { label: "Current Week", color: "hsl(var(--primary))" },
      lastWeek: { label: "Last Week", color: "hsl(var(--secondary-foreground))" },
      forecast: { label: "Forecast", color: "hsl(var(--destructive))" },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
            <Sparkles />
            Weekly Sales
        </CardTitle>
        <CardDescription>A rolling 7-day view of sales performance and a 7-day forecast. Shaded area shows confidence range. <span className="text-xs text-muted-foreground/80">(powered by AI)</span></CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[300px] flex items-center justify-center">
            <Loader2 className="animate-spin" />
          </div>
        ) : error ? (
            <Alert variant="destructive">
                <AlertTitle>Forecast Unavailable</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        ) : (
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <ComposedChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(value) => formatCurrency(value)} />
                <Tooltip
                    cursor={false}
                    content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                            return (
                                <div className="min-w-[8rem] rounded-lg border bg-background p-2 text-sm shadow-sm">
                                    <div className="font-bold">{label}</div>
                                    <div className="mt-2 grid gap-1.5">
                                        {payload
                                            .filter((item) => item.dataKey !== "forecastRange")
                                            .map((item) => (
                                            (typeof item.value === 'number' && item.value > 0) && <div
                                                key={item.dataKey}
                                                className="flex items-center gap-2"
                                            >
                                                <div
                                                    className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                                                    style={{
                                                        backgroundColor: item.color,
                                                    }}
                                                />
                                                <span className="text-muted-foreground">{item.name}:</span>
                                                <span className="font-mono font-medium tabular-nums text-foreground">
                                                    {formatCurrency(item.value as number)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )
                        }
                        return null;
                    }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="forecastRange"
                  fill="hsl(var(--destructive))"
                  fillOpacity={0.1}
                  stroke="none"
                  legendType="none"
                  tooltipType="none"
                />
                <Line type="monotone" dataKey="thisWeek" stroke="var(--color-thisWeek)" strokeWidth={2} name="Current Week" dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="lastWeek" stroke="var(--color-lastWeek)" strokeWidth={2} strokeDasharray="5 5" name="Last Week" dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="forecast" stroke="var(--color-forecast)" strokeWidth={3} name="Forecast" dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
