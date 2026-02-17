
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

// --- Date Helpers ---
function atStartOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function atEndOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
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
        // --- 1. DEFINE DATE RANGES ---
        const today = new Date();
        const thisWeekEnd = atEndOfDay(today);
        const thisWeekStart = atStartOfDay(addDays(today, -6));
        const lastWeekEnd = atEndOfDay(addDays(today, -7));
        const lastWeekStart = atStartOfDay(addDays(today, -13));
        
        const aiHistoryStart = addDays(today, -28);

        // --- 2. FETCH HISTORICAL DATA ---
        const q = query(
          collection(db, "stores", storeId, "analytics"),
          where("meta.dayStartMs", ">=", aiHistoryStart.getTime()),
          where("meta.dayStartMs", "<=", thisWeekEnd.getTime()),
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
        
        // --- 3. GET AI FORECAST ---
        const forecastInput: ForecastInput = { 
            historicalSales,
            storeLocation: activeStore.address,
            upcomingPayrollDates: [],
            upcomingHolidays: [],
        };
        const forecastResult = await forecastWeeklySales(forecastInput);

        // --- 4. PREPARE CHART DATA STRUCTURE ---
        const chartDataTemplate = [];
        for (let i = 0; i < 7; i++) {
            chartDataTemplate.push({
                name: format(addDays(thisWeekStart, i), 'E'), // 'Thu', 'Fri', etc.
                lastWeek: 0,
                thisWeek: 0,
                forecast: 0,
            });
        }
        
        const thisWeekStartDow = thisWeekStart.getDay(); // e.g. 4 for Thursday

        // --- 5. POPULATE 'thisWeek' and 'lastWeek' ---
        historicalSales.forEach(sale => {
          const [year, month, day] = sale.date.split('-').map(Number);
          const saleDate = new Date(year, month - 1, day);
          
          let targetKey: 'thisWeek' | 'lastWeek' | null = null;
          if (saleDate >= thisWeekStart && saleDate <= thisWeekEnd) {
            targetKey = 'thisWeek';
          } else if (saleDate >= lastWeekStart && saleDate <= lastWeekEnd) {
            targetKey = 'lastWeek';
          }

          if (targetKey) {
             const saleDow = saleDate.getDay();
             const index = (saleDow - thisWeekStartDow + 7) % 7;
             if (chartDataTemplate[index]) {
                chartDataTemplate[index][targetKey] = sale.netSales;
             }
          }
        });

        // --- 6. POPULATE 'forecast' ---
        forecastResult.forecast.forEach((dayForecast, i) => {
            const forecastDate = addDays(today, i + 1);
            const forecastDow = forecastDate.getDay();
            const index = (forecastDow - thisWeekStartDow + 7) % 7;
            if (chartDataTemplate[index]) {
                chartDataTemplate[index].forecast = dayForecast.forecastedSales;
            }
        });
        
        setData(chartDataTemplate);

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
