"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import type { DataAnalysisResult } from "@/hooks/use-data-analysis";
import { formatCurrency, formatNumber } from "./formatters";

const HIGHLIGHT = "#16a34a";
const BASE = "hsl(var(--primary))";

export function SalesByDowCard({ salesByDow }: { salesByDow: DataAnalysisResult["salesByDow"] }) {
  const max = salesByDow.reduce((m, r) => Math.max(m, r.net), 0);
  const bestDay = salesByDow.reduce((b, r) => (r.net > b.net ? r : b), salesByDow[0]);
  const total = salesByDow.reduce((s, r) => s + r.net, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales by Day of Week</CardTitle>
        <CardDescription>
          Net sales magnitude per weekday across the selected range.{" "}
          {total > 0 && bestDay ? (
            <>
              Strongest day: <span className="font-medium text-foreground">{bestDay.label}</span> ({formatCurrency(bestDay.net)}).
            </>
          ) : (
            "No sales in range."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={{}} className="h-[260px] w-full">
          <BarChart accessibilityLayer data={salesByDow}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => formatCurrency(Number(v))} fontSize={11} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as DataAnalysisResult["salesByDow"][number];
                return (
                  <div className="rounded-lg border bg-background p-2 text-sm shadow-sm">
                    <div className="font-semibold">{label}</div>
                    <div className="mt-1 font-mono">{formatCurrency(row.net)}</div>
                    <div className="text-xs text-muted-foreground">{formatNumber(row.sessions)} sessions</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="net" name="Net Sales" radius={[4, 4, 0, 0]}>
              {salesByDow.map((row) => (
                <Cell key={row.dow} fill={max > 0 && row.net === max ? HIGHLIGHT : BASE} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
