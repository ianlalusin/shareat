
"use client";

import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DailyMetric } from "@/lib/types";
import { fetchPartialDays } from "@/hooks/use-dashboard-analytics";
import { db } from "@/lib/firebase/client";

interface AvgRefillsCardProps {
    dailyMetrics?: DailyMetric[];
    isLoading: boolean;
}

type RefillTally = {
    [name: string]: number;
};

type AnalyticsTally = {
    sessionCount: number;
    overallTotal: number;
    totalsByName: RefillTally;
};

export function AvgRefillsCard({ dailyMetrics, isLoading }: AvgRefillsCardProps) {
    const analytics = useMemo<AnalyticsTally>(() => {
        const tally: AnalyticsTally = {
            sessionCount: 0,
            overallTotal: 0,
            totalsByName: {},
        };

        if (!dailyMetrics) return tally;

        dailyMetrics.forEach(metric => {
            tally.sessionCount += metric.refills?.packageSessionsCount ?? 0;
            tally.overallTotal += metric.refills?.servedRefillsTotal ?? 0;

            const byName = metric.refills?.servedRefillsByName ?? {};
            for (const [name, count] of Object.entries(byName)) {
                tally.totalsByName[name] = (tally.totalsByName[name] || 0) + count;
            }
        });

        return tally;
    }, [dailyMetrics]);

    const overallAvg = analytics.sessionCount > 0 ? analytics.overallTotal / analytics.sessionCount : 0;
    
    const sortedRefills = useMemo(() => {
        return Object.entries(analytics.totalsByName)
            .map(([name, total]) => ({
                name,
                total,
                avg: analytics.sessionCount > 0 ? total / analytics.sessionCount : 0,
            }))
            .sort((a, b) => b.total - a.total);
    }, [analytics]);

    const topRefills = sortedRefills.slice(0, 5);

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
        <Sheet>
            <Card>
                <CardHeader>
                     <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>Avg. Refill Count</CardTitle>
                            <CardDescription>Served refills per package session.</CardDescription>
                        </div>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="sm">View Details</Button>
                        </SheetTrigger>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="text-4xl font-bold">{overallAvg.toFixed(1)}</div>
                    <p className="text-xs text-muted-foreground">
                        {analytics.overallTotal} total refills across {analytics.sessionCount} sessions
                    </p>
                    <div className="mt-4 space-y-2">
                        {topRefills.map(refill => (
                            <div key={refill.name} className="flex justify-between items-center text-sm">
                                <span className="font-medium">{refill.name}</span>
                                <span className="text-muted-foreground">{refill.avg.toFixed(1)} avg</span>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
            <SheetContent className="w-full sm:max-w-lg flex flex-col">
                <SheetHeader>
                    <SheetTitle>All Refill Analytics</SheetTitle>
                    <SheetDescription>Complete breakdown of served refills for the selected period.</SheetDescription>
                </SheetHeader>
                <ScrollArea className="flex-1">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Refill</TableHead>
                                <TableHead className="text-right">Avg/Session</TableHead>
                                <TableHead className="text-right">Total Served</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedRefills.map(refill => (
                                <TableRow key={refill.name}>
                                    <TableCell className="font-medium">{refill.name}</TableCell>
                                    <TableCell className="text-right">{refill.avg.toFixed(2)}</TableCell>
                                    <TableCell className="text-right">{refill.total}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
}
