

"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Receipt } from "@/lib/types";

interface AvgRefillsCardProps {
    storeId: string;
    dateRange: { start: Date; end: Date };
}

type RefillTally = {
    [name: string]: number;
};

type AnalyticsTally = {
    sessionCount: number;
    overallTotal: number;
    totalsByName: RefillTally;
};

export function AvgRefillsCard({ storeId, dateRange }: AvgRefillsCardProps) {
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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
            where("sessionMode", "==", "package_dinein"),
            where("createdAt", ">=", Timestamp.fromDate(dateRange.start)),
            where("createdAt", "<=", Timestamp.fromDate(dateRange.end))
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedReceipts = snapshot.docs.map(doc => doc.data() as Receipt);
            setReceipts(fetchedReceipts);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching refill analytics:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [storeId, dateRange]);

    const analytics = useMemo<AnalyticsTally>(() => {
        const v2Receipts = receipts.filter(r => r.analytics?.v === 2);
        const tally: AnalyticsTally = {
            sessionCount: v2Receipts.length,
            overallTotal: 0,
            totalsByName: {},
        };

        v2Receipts.forEach(receipt => {
            const served = (receipt.analytics?.servedRefillsByName ?? {}) as Record<string, number>;
            for (const [name, count] of Object.entries(served)) {
                tally.totalsByName[name] = (tally.totalsByName[name] || 0) + count;
                tally.overallTotal += count;
            }
        });

        return tally;
    }, [receipts]);

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
                    <p className="text-center text-sm text-muted-foreground py-10">No package receipts with v2 analytics in this range.</p>
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
