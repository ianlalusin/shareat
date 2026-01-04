
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Timer } from "lucide-react";
import type { Receipt } from "@/lib/types";

interface AvgServingTimeCardProps {
    storeId: string;
    dateRange: { start: Date; end: Date };
}

type ServeTimeTally = {
    [key: string]: {
        totalMs: number;
        count: number;
    };
};

function formatDuration(ms: number): string {
    if (isNaN(ms) || ms < 0) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const paddedSeconds = seconds < 10 ? `0${seconds}` : seconds;
    return `${minutes}:${paddedSeconds}`;
}


export function AvgServingTimeCard({ storeId, dateRange }: AvgServingTimeCardProps) {
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
            where("createdAt", ">=", Timestamp.fromDate(dateRange.start)),
            where("createdAt", "<=", Timestamp.fromDate(dateRange.end))
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedReceipts = snapshot.docs.map(doc => doc.data() as Receipt);
            setReceipts(fetchedReceipts);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching serving time analytics:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [storeId, dateRange]);

    const analytics = useMemo(() => {
        const tally: ServeTimeTally = {};
        let hasData = false;

        receipts.forEach(receipt => {
            const timeData = receipt.analytics?.serveTimeMsTotalByType;
            const countData = receipt.analytics?.serveCountByType;

            if (timeData && countData) {
                for (const type in timeData) {
                    if (countData[type]) {
                        hasData = true;
                        if (!tally[type]) {
                            tally[type] = { totalMs: 0, count: 0 };
                        }
                        tally[type].totalMs += timeData[type];
                        tally[type].count += countData[type];
                    }
                }
            }
        });

        const sortedTypes = Object.entries(tally)
            .sort(([, a], [, b]) => b.count - a.count)
            .map(([type, data]) => ({
                type,
                avgMs: data.count > 0 ? data.totalMs / data.count : 0,
                count: data.count,
            }));
            
        const totalMs = Object.values(tally).reduce((sum, { totalMs }) => sum + totalMs, 0);
        const totalCount = Object.values(tally).reduce((sum, { count }) => sum + count, 0);
        const overallAvg = totalCount > 0 ? totalMs / totalCount : 0;

        return { data: sortedTypes, overallAvg, hasData };
    }, [receipts]);
    
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
                    <p className="text-center text-sm text-muted-foreground py-10">No serving time analytics yet for this period.</p>
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
                            <TableHead className="text-right">Avg (mm:ss)</TableHead>
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
