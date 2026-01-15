
"use client";

import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { DailyMetric } from "@/lib/types";

interface AvgRefillsCardProps {
    dailyMetrics?: DailyMetric[];
    isLoading: boolean;
}

type AnalyticsTally = {
    sessionCount: number;
    overallTotal: number;
};

export function AvgRefillsCard({ dailyMetrics, isLoading }: AvgRefillsCardProps) {
    const analytics = useMemo<AnalyticsTally>(() => {
        const tally: AnalyticsTally = {
            sessionCount: 0,
            overallTotal: 0,
        };

        if (!dailyMetrics) return tally;

        dailyMetrics.forEach(metric => {
            tally.sessionCount += metric.refills?.packageSessionsCount ?? 0;
            tally.overallTotal += metric.refills?.servedRefillsTotal ?? 0;
        });

        return tally;
    }, [dailyMetrics]);

    const overallAvg = analytics.sessionCount > 0 ? analytics.overallTotal / analytics.sessionCount : 0;

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Avg. Refill Count</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                </CardContent>
            </Card>
        );
    }
    
    if (analytics.sessionCount === 0) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle>Avg. Refill Count</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-center text-sm text-muted-foreground py-10">No package sessions in this range.</p>
                </CardContent>
            </Card>
        )
    }
    
    return (
        <Card>
            <CardHeader>
                <CardTitle>Avg. Refill Count</CardTitle>
                <CardDescription>Served refills per package session.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="text-4xl font-bold">{overallAvg.toFixed(1)}</div>
                <p className="text-xs text-muted-foreground">
                    {analytics.overallTotal} total refills across {analytics.sessionCount} sessions
                </p>
            </CardContent>
        </Card>
    );
}
