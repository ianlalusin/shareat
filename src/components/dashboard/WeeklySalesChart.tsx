
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

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatCurrency(value: number) {
    if (value >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `₱${(value / 1_000).toFixed(1)}k`;
    return `₱${value.toFixed(0)}`;
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
        const fourWeeksAgo = addDays(today, -28);

        const q = query(
          collection(db, "stores", storeId, "analytics"),
          where("meta.dayStartMs", ">=", fourWeeksAgo.getTime()),
          where("meta.dayStartMs", "<=", today.getTime()),
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

        // Placeholder data for new context.
        // In a real application, this would come from a configuration or a service.
        const upcomingPayrollDates: string[] = []; // Example: ["2024-07-15", "2024-07-30"]
        const upcomingHolidays: string[] = []; // Example: ["National Heroes Day"]
        
        const forecastInput: ForecastInput = { 
            historicalSales,
            storeLocation: activeStore.address,
            upcomingPayrollDates,
            upcomingHolidays,
        };
        const forecastResult = await forecastWeeklySales(forecastInput);

        const todayDow = today.getDay(); // 0 = Sunday
        const startOfThisWeek = startOfWeek(today, { weekStartsOn: 0 });
        const startOfLastWeek = addDays(startOfThisWeek, -7);

        const chartData = DOW.map((day) => ({
          name: day,
          lastWeek: 0,
          thisWeek: 0,
          forecast: 0,
        }));

        historicalSales.forEach(sale => {
          const [year, month, day] = sale.date.split('-').map(Number);
          const saleDate = new Date(year, month - 1, day);
          const dow = saleDate.getDay();
          
          if (saleDate >= startOfLastWeek && saleDate < startOfThisWeek) {
            chartData[dow].lastWeek = sale.netSales;
          } else if (saleDate >= startOfThisWeek && saleDate <= today) {
            chartData[dow].thisWeek = sale.netSales;
          }
        });

        forecastResult.forecast.forEach((forecastItem, index) => {
          // The forecast starts from "tomorrow"
          const forecastDow = (todayDow + 1 + index) % 7;
          chartData[forecastDow].forecast = forecastItem.forecastedSales;
        });
        
        // Reorder the data to start from tomorrow and end with today
        const orderedChartData = [];
        for (let i = 1; i <= 7; i++) {
            const dowIndex = (todayDow + i) % 7;
            orderedChartData.push(chartData[dowIndex]);
        }
        setData(orderedChartData);

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
                <Line type="monotone" dataKey="forecast" stroke="var(--color-forecast)" strokeWidth={2} strokeDasharray="2 6" name="Forecast" dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
