
"use client";

import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { collection, query, where, orderBy, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { addDays, format, startOfWeek } from "date-fns";
import { forecastWeeklySales, type ForecastInput } from "@/ai/flows/forecast-weekly-sales";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useStoreContext } from "@/context/store-context";

interface WeeklySalesChartProps {
  storeId: string;
}

function formatCurrency(value: number) {
    if (value >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `₱${(value / 1_000).toFixed(1)}k`;
    return `₱${value.toFixed(0)}`;
}

// --- Date Helpers ---
function atStartOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
        const startDate = addDays(endDate, -27); // Fetch 4 weeks of data

        const q = query(
          collection(db, "stores", storeId, "analytics"),
          where("meta.dayStartMs", ">=", startDate.getTime()),
          where("meta.dayStartMs", "<=", endDate.getTime()),
          orderBy("meta.dayStartMs", "asc")
        );

        const snapshot = await getDocs(q);
        const historicalSales = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            date: format(new Date(data.meta.dayStartMs), "yyyy-MM-dd"),
            netSales: data.payments?.totalGross || 0,
          };
        });

        if (historicalSales.length < 7) {
          setError("Not enough data to generate a forecast. At least 7 days of sales are required.");
          setIsLoading(false);
          return;
        }

        const forecastInput: ForecastInput = {
          historicalSales,
          storeLocation: activeStore.address,
          upcomingPayrollDates: [],
          upcomingHolidays: [],
        };
        const forecastResult = await forecastWeeklySales(forecastInput);

        const salesByDate = new Map(historicalSales.map(s => [s.date, s.netSales]));
        const forecastByDay = new Map(forecastResult.forecast.map(f => [f.day, f.forecastedSales]));

        const chartData = [];
        for (let i = 6; i >= 0; i--) {
            const currentDay = addDays(endDate, -i);
            const lastWeekDay = addDays(currentDay, -7);
            const nextWeekDay = addDays(currentDay, 7);
            
            const currentDayStr = format(currentDay, "yyyy-MM-dd");
            const lastWeekDayStr = format(lastWeekDay, "yyyy-MM-dd");

            chartData.push({
                name: format(currentDay, 'E'), // 'Thu', 'Fri', etc.
                thisWeek: salesByDate.get(currentDayStr) ?? 0,
                lastWeek: salesByDate.get(lastWeekDayStr) ?? 0,
                forecast: forecastByDay.get(format(nextWeekDay, 'EEEE')) ?? 0,
            });
        }
        
        setData(chartData);

      } catch (err: any) {
        console.error("Failed to fetch data or forecast sales:", err);
        setError("Could not load sales forecast. " + err.message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchDataAndForecast();
  }, [storeId, activeStore]);
  
  const chartConfig = {
      thisWeek: { label: "This Week", color: "hsl(var(--primary))" },
      lastWeek: { label: "Last Week", color: "hsl(var(--secondary-foreground))" },
      forecast: { label: "Forecast", color: "hsl(var(--destructive))" },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly Sales</CardTitle>
        <CardDescription>Sales performance by day of the week.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[300px] flex items-center justify-center">
            <Loader2 className="animate-spin" />
          </div>
        ) : error ? (
           <div className="h-[300px] flex items-center justify-center">
                <Alert variant="destructive" className="max-w-sm">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            </div>
        ) : (
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <LineChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(value) => formatCurrency(value)} />
                <Tooltip content={<ChartTooltipContent formatter={(value) => `₱${Number(value).toLocaleString()}`} />} />
                <Legend />
                <Line type="monotone" dataKey="thisWeek" stroke="var(--color-thisWeek)" strokeWidth={2} name="This Week" dot={{ r: 2 }} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="lastWeek" stroke="var(--color-lastWeek)" strokeWidth={2} strokeDasharray="5 5" name="Last Week" dot={{ r: 2 }} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="forecast" stroke="var(--color-forecast)" strokeWidth={4} name="Forecast" dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
