
"use client";

import { useState, useEffect, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { collection, query, where, orderBy, getDocs, Timestamp, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { addDays, format, startOfWeek } from "date-fns";
import { forecastWeeklySales, type ForecastInput } from "@/ai/flows/forecast-weekly-sales";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useStoreContext } from "@/context/store-context";
import type { WeatherRecord, DailyMetric } from "@/lib/types";

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

/**
 * Generates a list of upcoming payroll dates based on common mid-month and end-of-month schedules.
 * Adjusts for weekends by moving the payday to the preceding Friday.
 * @returns {string[]} An array of formatted payroll dates (YYYY-MM-DD).
 */
function getUpcomingPayrollDates(): string[] {
    const dates: Date[] = [];
    const today = atStartOfDay(new Date());

    // Look at current month and next two months for potential paydays
    for (let i = 0; i < 3; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const year = d.getFullYear();
        const month = d.getMonth();

        // Mid-month payday (around 15th)
        let midMonthPayday = new Date(year, month, 15);
        if (midMonthPayday.getDay() === 6) { // Saturday -> Friday
            midMonthPayday.setDate(midMonthPayday.getDate() - 1);
        } else if (midMonthPayday.getDay() === 0) { // Sunday -> Friday
            midMonthPayday.setDate(midMonthPayday.getDate() - 2);
        }

        // End-of-month payday (last day of month)
        let endOfMonthPayday = new Date(year, month + 1, 0);
        if (endOfMonthPayday.getDay() === 6) { // Saturday -> Friday
            endOfMonthPayday.setDate(endOfMonthPayday.getDate() - 1);
        } else if (endOfMonthPayday.getDay() === 0) { // Sunday -> Friday
            endOfMonthPayday.setDate(endOfMonthPayday.getDate() - 2);
        }

        if (midMonthPayday >= today) dates.push(midMonthPayday);
        if (endOfMonthPayday >= today) dates.push(endOfMonthPayday);
    }
    
    // Using Set to handle duplicates, then sort and format.
    return [...new Set(dates.map(d => d.getTime()))]
        .map(time => new Date(time))
        .sort((a,b) => a.getTime() - b.getTime())
        .map(date => format(date, "yyyy-MM-dd"));
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

      try {
        const today = new Date();
        const endDate = atStartOfDay(today);
        const startDate = addDays(endDate, -27); // Fetch ~4 weeks of historical data
        const todayDayId = format(today, "yyyyMMdd");

        // Queries
        const salesQuery = query(
          collection(db, "stores", storeId, "analytics"),
          where("meta.dayStartMs", ">=", startDate.getTime()),
          where("meta.dayStartMs", "<=", endDate.getTime()),
          orderBy("meta.dayStartMs", "asc")
        );
        const weatherQuery = collection(db, "stores", storeId, "weatherRecords");
        
        // Fetch today's live sales directly from the daily analytics doc for accuracy
        const todayAnalyticsDocRef = doc(db, "stores", storeId, "analytics", todayDayId);

        const [salesSnapshot, weatherSnapshot, todayAnalyticsSnap] = await Promise.all([
            getDocs(salesQuery),
            getDocs(query(weatherQuery, where("dayId", ">=", format(startDate, "yyyyMMdd")), where("dayId", "<=", format(endDate, "yyyyMMdd")))),
            getDoc(todayAnalyticsDocRef)
        ]);
        
        const todayLiveSales = todayAnalyticsSnap.exists() ? (todayAnalyticsSnap.data() as DailyMetric).payments?.totalGross ?? 0 : 0;

        const historicalSales = salesSnapshot.docs.map((doc) => {
          const data = doc.data();
          const dayId = data.meta.dayId;
          const netSales = data.payments?.totalGross || 0;

          // Replace today's historical data (which might be partial) with the live data
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
        
        // Add today's live sales if not already in the historical data (e.g., if no other receipts exist for today)
        const hasTodayData = historicalSales.some(s => s.date === format(today, 'yyyy-MM-dd'));
        if (!hasTodayData && todayLiveSales > 0) {
            historicalSales.push({
                date: format(today, 'yyyy-MM-dd'),
                netSales: todayLiveSales,
            });
        }
        
        const historicalWeather = weatherSnapshot.docs.map(doc => {
            const data = doc.data() as WeatherRecord;
            const conditions = data.entries.map(e => e.condition);
            // Simple summary: find the most frequent condition
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

        const upcomingPayrollDates = getUpcomingPayrollDates();

        const forecastInput: ForecastInput = {
          historicalSales,
          historicalWeather,
          storeLocation: activeStore.address,
          upcomingPayrollDates,
        };
        const forecastResult = await forecastWeeklySales(forecastInput);

        const salesByDate = new Map(historicalSales.map(s => [s.date, s.netSales]));
        const forecastByDay = new Map(forecastResult.forecast.map(f => [f.day, f.forecastedSales]));

        const chartData = [];

        // Build rolling 7 days ending today
        for (let i = 6; i >= 0; i--) {
            const currentDay = addDays(today, -i);
            const lastWeekDay = addDays(currentDay, -7);

            chartData.push({
                name: format(currentDay, 'E'), // "Mon", "Tue"
                thisWeek: salesByDate.get(format(currentDay, "yyyy-MM-dd")) ?? 0,
                lastWeek: salesByDate.get(format(lastWeekDay, "yyyy-MM-dd")) ?? 0,
                forecast: 0, // No forecast for past days
            });
        }
        
        // Add forecast data starting from tomorrow
        for (let i = 1; i <= 7; i++) {
            const forecastDay = addDays(today, i);
            const dayName = format(forecastDay, 'EEEE'); // "Monday", "Tuesday"
            const dayAbbr = format(forecastDay, 'E');
            
            const existingIndex = chartData.findIndex(d => d.name === dayAbbr);
            if (existingIndex !== -1) {
                chartData[existingIndex].forecast = forecastByDay.get(dayName) ?? 0;
            } else {
                 chartData.push({
                    name: dayAbbr,
                    thisWeek: 0,
                    lastWeek: 0,
                    forecast: forecastByDay.get(dayName) ?? 0,
                });
            }
        }
        // Ensure we only have 7 days in the final chart, with today at the end.
        const finalChartData = chartData.slice(chartData.length - 7);


        setData(finalChartData);

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
        <CardTitle>Weekly Sales</CardTitle>
        <CardDescription>A rolling 7-day view of sales performance and a 7-day forecast.</CardDescription>
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
              <LineChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
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
                                        {payload.map((item) => (
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
                <Line type="monotone" dataKey="thisWeek" stroke="var(--color-thisWeek)" strokeWidth={2} name="Current Week" dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="lastWeek" stroke="var(--color-lastWeek)" strokeWidth={2} strokeDasharray="5 5" name="Last Week" dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="forecast" stroke="var(--color-forecast)" strokeWidth={3} name="Forecast" dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
