"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartContainer } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { DataAnalysisResult } from "@/hooks/use-data-analysis";
import { formatCurrency } from "./formatters";

export function SalesOverTimeCard({ salesOverTime }: { salesOverTime: DataAnalysisResult["salesOverTime"] }) {
  const byDayData = (salesOverTime.byDay || []).map((d) => ({
    dayLabel: `${d.date.getMonth() + 1}/${d.date.getDate()}`,
    net: d.net,
    tx: d.tx,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales Over Time</CardTitle>
        <CardDescription>Net sales trend across the selected range.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="month">
          <TabsList>
            <TabsTrigger value="month">By Month</TabsTrigger>
            <TabsTrigger value="day" disabled={!salesOverTime.byDay}>
              By Day {salesOverTime.byDay ? "" : "(≤ 90 days)"}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="month">
            <ChartContainer config={{}} className="h-[280px] w-full">
              <BarChart accessibilityLayer data={salesOverTime.byMonth}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => formatCurrency(Number(v))} fontSize={11} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-lg border bg-background p-2 text-sm shadow-sm">
                        <div className="font-semibold">{label}</div>
                        <div className="mt-1 font-mono">{formatCurrency(Number(payload[0].value))}</div>
                        <div className="text-xs text-muted-foreground">{payload[0].payload?.tx} txns</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="net" name="Net Sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </TabsContent>
          <TabsContent value="day">
            {salesOverTime.byDay ? (
              <ChartContainer config={{}} className="h-[280px] w-full">
                <LineChart accessibilityLayer data={byDayData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="dayLabel" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => formatCurrency(Number(v))} fontSize={11} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border bg-background p-2 text-sm shadow-sm">
                          <div className="font-semibold">{label}</div>
                          <div className="mt-1 font-mono">{formatCurrency(Number(payload[0].value))}</div>
                        </div>
                      );
                    }}
                  />
                  <Line type="monotone" dataKey="net" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Daily view is available for ranges ≤ 90 days. Narrow the range to enable it.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
