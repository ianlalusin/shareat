
"use client";

import { Bar, BarChart, CartesianGrid, Legend, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

function formatCurrency(value: number) {
    if (value >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `₱${(value / 1_000).toFixed(1)}k`;
    return `₱${value}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthlySalesTrendChartProps {
  data: any[];
  isLoading: boolean;
}

export function MonthlySalesTrendChart({ data, isLoading }: MonthlySalesTrendChartProps) {
    const chartData = data.map(d => ({
        ...d,
        monthLabel: MONTHS[d.month - 1]
    }));

    return (
        <Card>
            <CardHeader>
                <CardTitle>Monthly Sales Trend</CardTitle>
                <CardDescription>Comparing this year's sales to last year's, month by month.</CardDescription>
            </CardHeader>
            <CardContent>
                <ChartContainer config={{}} className="h-[300px] w-full">
                    <BarChart accessibilityLayer data={chartData}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                            dataKey="monthLabel"
                            tickLine={false}
                            tickMargin={10}
                            axisLine={false}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => formatCurrency(Number(value))}
                        />
                         <Tooltip
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    return (
                                        <div className="min-w-[12rem] rounded-lg border bg-background p-2 text-sm shadow-sm">
                                            <div className="font-bold">{label}</div>
                                            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-primary" />
                                                    <span className="text-muted-foreground">This Year:</span>
                                                </div>
                                                <span className="font-mono font-medium tabular-nums text-foreground">{formatCurrency(payload[0].value as number)}</span>
                                                <div className="flex items-center gap-2">
                                                     <div className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-secondary" />
                                                    <span className="text-muted-foreground">Last Year:</span>
                                                </div>
                                                 <span className="font-mono font-medium tabular-nums text-foreground">{formatCurrency(payload[1].value as number)}</span>
                                            </div>
                                        </div>
                                    )
                                }
                                return null;
                            }}
                        />
                        <Legend />
                        <Bar dataKey="curGross" name="This Year" fill="var(--color-primary)" radius={4} />
                        <Bar dataKey="prevGross" name="Last Year" fill="var(--color-secondary)" radius={4} />
                    </BarChart>
                </ChartContainer>
            </CardContent>
        </Card>
    );
}

