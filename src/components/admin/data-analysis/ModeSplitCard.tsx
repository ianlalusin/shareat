"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import type { DataAnalysisResult } from "@/hooks/use-data-analysis";
import { formatCurrency, formatPercent } from "./formatters";

const DINEIN_COLOR = "#16a34a";
const WALKIN_COLOR = "#f59e0b";

export function ModeSplitCard({ modeSplit }: { modeSplit: DataAnalysisResult["modeSplit"] }) {
  const total = modeSplit.salesShare.dineIn + modeSplit.salesShare.walkIn;
  const dineInPct = total > 0 ? modeSplit.salesShare.dineIn / total : 0;
  const walkInPct = total > 0 ? modeSplit.salesShare.walkIn / total : 0;
  const pieData = [
    { name: "Dine-In", value: modeSplit.salesShare.dineIn, color: DINEIN_COLOR },
    { name: "Walk-In", value: modeSplit.salesShare.walkIn, color: WALKIN_COLOR },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dine-In vs Walk-In</CardTitle>
        <CardDescription>Sales share and monthly breakdown by service type.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2">
            <ChartContainer config={{}} className="h-[260px] w-full">
              <BarChart accessibilityLayer data={modeSplit.byMonth}>
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
                <Bar dataKey="dineIn" name="Dine-In" fill={DINEIN_COLOR} stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="walkIn" name="Walk-In" fill={WALKIN_COLOR} stackId="a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </div>
          <div className="flex flex-col items-center justify-center">
            <ChartContainer config={{}} className="h-[180px] w-full">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {pieData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="mt-2 space-y-1 text-sm w-full">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DINEIN_COLOR }} /> Dine-In
                </span>
                <span className="font-mono">{formatPercent(dineInPct)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: WALKIN_COLOR }} /> Walk-In
                </span>
                <span className="font-mono">{formatPercent(walkInPct)}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
