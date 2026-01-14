

"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import type { DailyMetric } from "@/lib/types";

interface AvgServingTimeCardProps {
    dailyMetrics: DailyMetric[];
    isLoading: boolean;
}

function formatDuration(ms: number): string {
    if (isNaN(ms) || ms < 0) return "00:00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const paddedHours = hours.toString().padStart(2, '0');
    const paddedMinutes = minutes.toString().padStart(2, '0');
    const paddedSeconds = seconds.toString().padStart(2, '0');

    return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
}

export function AvgServingTimeCard({ dailyMetrics, isLoading }: AvgServingTimeCardProps) {
    
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
                <CardHeader>
                    <CardTitle>Avg. Serving Time</CardTitle>
                    <CardDescription>Kitchen performance metrics.</CardDescription>
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
                <CardHeader>
                    <CardTitle>Avg. Serving Time</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-center text-sm text-muted-foreground py-10">No served tickets in this range.</p>
                </CardContent>
            </Card>
        )
    }
    
    return (
        <Card>
            <CardHeader>
                 <CardTitle>Avg. Serving Time</CardTitle>
                 <CardDescription>Overall average: <span className="font-bold text-lg">{formatDuration(analytics.overallAvg)}</span></CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Item Type</TableHead>
                            <TableHead className="text-right">Avg (hh:mm:ss)</TableHead>
                            <TableHead className="text-right">Count</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {analytics.data.map(({ type, avgMs, count }) => (
                            <TableRow key={type}>
                                <TableCell className="font-medium capitalize">{type}</TableCell>
                                <TableCell className="text-right font-mono">{formatDuration(avgMs)}</TableCell>
                                <TableCell className="text-right font-mono">{count}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    )
}
