
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toJsDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartConfig, ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

interface PeakHoursCardProps {
    storeId: string;
    dateRange: { start: Date; end: Date };
}

type Receipt = {
    createdAt: any;
    analytics?: { v?: number; grandTotal?: number, sessionStartedAt?: any, sessionStartedAtClientMs?: number };
    total?: number;
}

const chartConfig = {
  sales: {
    label: "Sales",
    color: "hsl(var(--destructive))",
  },
} satisfies ChartConfig;

function formatCurrency(value: number) {
    if (value >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `₱${(value / 1_000).toFixed(1)}k`;
    return `₱${value}`;
}

export function PeakHoursCard({ storeId, dateRange }: PeakHoursCardProps) {
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAllHours, setShowAllHours] = useState(false);

    useEffect(() => {
        if (!storeId) {
            setIsLoading(false);
            setReceipts([]);
            return;
        }
        setIsLoading(true);

        const receiptsRef = collection(db, "stores", storeId, "receipts");
        const q = query(
            receiptsRef,
            where("status", "==", "final"),
            where("createdAt", ">=", Timestamp.fromDate(dateRange.start)),
            where("createdAt", "<=", Timestamp.fromDate(dateRange.end))
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedReceipts = snapshot.docs.map(doc => doc.data() as Receipt);
            setReceipts(fetchedReceipts);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching peak hours data:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [storeId, dateRange]);

    const formatHour = (hour: number) => {
        if (hour === 0) return "12 AM";
        if (hour === 12) return "12 PM";
        if (hour < 12) return `${hour} AM`;
        return `${hour - 12} PM`;
    };

    const hourlyData = useMemo(() => {
        const salesByHour = Array(24).fill(0);
        const countByHour = Array(24).fill(0);

        receipts.forEach(receipt => {
            // Prioritize session start time, fallback to receipt creation time
            const primaryTs = receipt.analytics?.sessionStartedAt;
            const primaryMs = receipt.analytics?.sessionStartedAtClientMs;
            const fallbackTs = receipt.createdAt;
            
            const date = toJsDate(primaryTs) ?? (primaryMs ? new Date(primaryMs) : toJsDate(fallbackTs));

            if (date) {
                const hour = date.getHours();
                const amount = receipt.analytics?.grandTotal ?? receipt.total ?? 0;
                salesByHour[hour] += amount;
                countByHour[hour] += 1;
            }
        });

        const maxSale = Math.max(...salesByHour);
        const peakHourIndex = salesByHour.indexOf(maxSale);
        
        const data = salesByHour.map((sales, hour) => ({
            hour: hour,
            label: formatHour(hour),
            sales: sales,
            receipts: countByHour[hour],
        }));

        return {
            processedData: data,
            peakHour: data[peakHourIndex],
            totalReceipts: receipts.length,
            maxSale
        };
    }, [receipts]);
    
    const chartData = useMemo(() => {
        if (showAllHours) return hourlyData.processedData;
        return hourlyData.processedData.filter(d => d.receipts > 0);
    }, [hourlyData.processedData, showAllHours]);


    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Peak Hours</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                </CardContent>
            </Card>
        );
    }
    
    if (hourlyData.totalReceipts === 0) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle>Peak Hours</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-center text-sm text-muted-foreground py-10">No receipts in this range.</p>
                </CardContent>
            </Card>
        )
    }
    
    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle>Peak Hours</CardTitle>
                        <CardDescription>Based on session start times.</CardDescription>
                    </div>
                     <div className="flex items-center space-x-2">
                        <Label htmlFor="show-all-hours">Show All Hours</Label>
                        <Switch id="show-all-hours" checked={showAllHours} onCheckedChange={setShowAllHours} />
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="mb-4 text-center">
                    <p className="text-sm text-muted-foreground">Peak Hour</p>
                    <p className="text-lg font-bold">
                        {formatHour(hourlyData.peakHour.hour)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {formatCurrency(hourlyData.peakHour.sales)} • {hourlyData.peakHour.receipts} receipts
                    </p>
                </div>
                <ChartContainer config={chartConfig} className="h-[260px] w-full">
                    <BarChart accessibilityLayer data={chartData}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                            dataKey="label"
                            tickLine={false}
                            tickMargin={10}
                            axisLine={false}
                            tickFormatter={(value) => value.slice(0, 3)}
                        />
                         <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => formatCurrency(Number(value))}
                        />
                        <Tooltip
                            cursor={false}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                        <div className="min-w-[8rem] rounded-lg border bg-background p-2 text-sm shadow-sm">
                                            <div className="font-bold">{label}</div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Sales:</span>
                                                <span className="font-medium">{formatCurrency(data.sales)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Receipts:</span>
                                                <span className="font-medium">{data.receipts}</span>
                                            </div>
                                        </div>
                                    )
                                }
                                return null;
                            }}
                        />
                        <Bar dataKey="sales" fill="var(--color-sales)" radius={4} />
                    </BarChart>
                </ChartContainer>
            </CardContent>
        </Card>
    );
}
