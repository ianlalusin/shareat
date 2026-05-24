"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Clock } from "lucide-react";
import type { DailyMetric } from "@/lib/types";

import { formatDurationHuman } from "@/lib/utils/date";

export function AvgSessionTimeCard({ dailyMetrics, isLoading }: { dailyMetrics: DailyMetric[]; isLoading: boolean; }) {
    const analytics = useMemo(() => {
        let totalMs = 0;
        let count = 0;
        dailyMetrics.forEach(metric => {
            totalMs += metric.sessions?.dineInDurationMsSum || 0;
            count += metric.sessions?.dineInDurationCount || 0;
        });
        return {
            avgMs: count > 0 ? totalMs / count : 0,
            count,
            hasData: count > 0,
        };
    }, [dailyMetrics]);

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" /> Avg. Dine-In Session
                </CardTitle>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                ) : !analytics.hasData ? (
                    <p className="text-center text-sm text-muted-foreground py-10">No completed dine-in sessions in this range.</p>
                ) : (
                    <div className="text-center py-4 space-y-1">
                        <div className="text-3xl font-bold tabular-nums">{formatDurationHuman(analytics.avgMs)}</div>
                        <div className="text-xs text-muted-foreground">across {analytics.count.toLocaleString("en-US")} session{analytics.count === 1 ? "" : "s"}</div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
