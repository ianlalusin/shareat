"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { DataAnalysisResult } from "@/hooks/use-data-analysis";
import { formatCurrency, formatNumber, formatPercent, deltaPercent } from "./formatters";

function DeltaCell({ label, current, previous, format }: {
  label: string;
  current: number;
  previous: number;
  format: (n: number) => string;
}) {
  const delta = deltaPercent(current, previous);
  const isUp = delta >= 0;
  const colorClass = isUp ? "text-emerald-600" : "text-red-600";
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{format(current)}</div>
      <div className={`mt-1 text-xs flex items-center gap-1 ${colorClass}`}>
        {isUp ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        <span>{formatPercent(Math.abs(delta))}</span>
        <span className="text-muted-foreground">vs {format(previous)}</span>
      </div>
    </div>
  );
}

export function ComparativeCard({ comparative }: { comparative: DataAnalysisResult["comparative"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparative Analysis</CardTitle>
        <CardDescription>Current period vs prior period, plus year-over-year monthly trend.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DeltaCell label="Net Sales" current={comparative.current.netSales} previous={comparative.previous.netSales} format={formatCurrency} />
          <DeltaCell label="Transactions" current={comparative.current.tx} previous={comparative.previous.tx} format={formatNumber} />
          <DeltaCell label="Dine-In Share" current={comparative.current.dineInShare} previous={comparative.previous.dineInShare} format={(n) => formatPercent(n)} />
          <DeltaCell label="Guests" current={comparative.current.guests} previous={comparative.previous.guests} format={formatNumber} />
        </div>
        <div className="mt-6">
          <div className="text-sm font-medium mb-2">Monthly: this year vs last year</div>
          <ChartContainer config={{}} className="h-[260px] w-full">
            <BarChart accessibilityLayer data={comparative.yoyByMonth}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => formatCurrency(Number(v))} fontSize={11} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="rounded-lg border bg-background p-2 text-sm shadow-sm">
                      <div className="font-semibold">{label}</div>
                      {payload.map((p) => (
                        <div key={String(p.dataKey)} className="flex items-center gap-2 mt-1">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
                          <span className="text-muted-foreground">{p.name}:</span>
                          <span className="font-mono">{formatCurrency(Number(p.value))}</span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Bar dataKey="thisYear" name="This Year" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="lastYear" name="Last Year" fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
