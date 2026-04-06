
"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import type { DailyMetric } from "@/lib/types";

import { formatDuration } from "@/lib/utils/date";

export function AvgServingTimeCard({ dailyMetrics, isLoading }: { dailyMetrics: DailyMetric[]; isLoading: boolean; }) {
    
    const analytics = useMemo(() => {
        const tally: Record<string, { totalMs: number; count: number }> = {};
        let totalMsOverall = 0;
        let totalCountOverall = 0;

        dailyMetrics.forEach(metric => {
            const byTypeSum = metric.kitchen?.durationMsSumByType ?? {};
            const countsByType = metric.kitchen?.durationCountByType ?? {};
            
            for (const [type, sum] of Object.entries(byTypeSum)) {
                if (!tally[type]) tally[type] = { totalMs: 0, count: 0 };
                tally[type].totalMs += sum;
                
                const countForType = countsByType[type] || 0;
                tally[type].count += countForType;

                totalMsOverall += sum;
                totalCountOverall += countForType;
            }
        });
        
        const sortedTypes = Object.entries(tally)
            .map(([type, data]) => ({
                type,
                avgMs: data.count > 0 ? data.totalMs / data.count : 0,
                count: data.count,
            }))
            .sort((a,b) => b.count - a.count);

        return {
            data: sortedTypes,
            overallAvg: totalCountOverall > 0 ? totalMsOverall / totalCountOverall : 0,
            hasData: totalCountOverall > 0,
        }
    }, [dailyMetrics]);

    if (isLoading) {
        return (
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Avg. Serving Time</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                </CardContent>
            </Card>
        );
    }
    
    if (!analytics.hasData) {
        return (
             <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Avg. Serving Time</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-center text-sm text-muted-foreground py-10">No served tickets in this range.</p>
                </CardContent>
            </Card>
        )
    }
    
    return (
        <Card>
            <CardHeader className="pb-3">
                 <CardTitle className="text-base">Avg. Serving Time</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground text-center">Overall average: <span className="font-medium text-foreground">{formatDuration(analytics.overallAvg)}</span></div>
                <div className="space-y-2">
                    {analytics.data.map(({ type, avgMs, count }) => (
                         <div key={type} className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="truncate text-sm capitalize">{type}</div>
                                <div className="text-xs text-muted-foreground">{count.toLocaleString('en-US')} items</div>
                            </div>
                            <div className="shrink-0 text-sm font-medium tabular-nums">
                                {formatDuration(avgMs)}
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}
