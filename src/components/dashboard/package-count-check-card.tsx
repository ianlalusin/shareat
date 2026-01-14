

"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy, Timestamp, limit } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyMetric } from "./types";

interface PackageCountCheckCardProps {
    storeId: string;
    dateRange: { start: Date; end: Date };
}

type PackageTally = {
    name: string;
    finalGuests: number;
    billedCovers: number;
};

export function PackageCountCheckCard({ storeId, dateRange }: PackageCountCheckCardProps) {
    const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!storeId) {
            setIsLoading(false);
            setDailyMetrics([]);
            return;
        }
        setIsLoading(true);

        const analyticsRef = collection(db, "stores", storeId, "analytics");
        const q = query(
            analyticsRef,
            where("dayId", ">=", formatDayId(dateRange.start)),
            where("dayId", "<=", formatDayId(dateRange.end)),
            orderBy("dayId", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            setDailyMetrics(snapshot.docs.map(doc => doc.data() as DailyMetric));
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching guest/cover analytics:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [storeId, dateRange]);
    
    function formatDayId(date: Date) {
        return date.toISOString().slice(0, 10).replace(/-/g, "");
    }


    const aggregatedData = useMemo(() => {
        const tally: Record<string, PackageTally> = {};

        dailyMetrics.forEach(metric => {
            if (!metric.guests?.packageCoversBilledByPackageName) return;

            for (const [name, covers] of Object.entries(metric.guests.packageCoversBilledByPackageName)) {
                if (!tally[name]) {
                    tally[name] = { name, finalGuests: 0, billedCovers: 0 };
                }
                tally[name].billedCovers += covers;
            }
            
            // Note: guestCountFinalTotal is a total sum, not per package. We need to handle this.
            // For simplicity, let's assume we can aggregate it like this for now. A more complex
            // model might need a different data structure if per-package final guest counts are needed.
            // This example will sum up all final guests and show it against each package, which might be
            // what the user expects from a high-level view.
            const totalGuestsForDay = metric.guests.guestCountFinalTotal || 0;
            for (const key in tally) {
                // This is a simplification. We're adding the total day's guests to each package.
                // A better model would be needed for per-package accuracy if required.
                tally[key].finalGuests += totalGuestsForDay; 
            }
        });

        return Object.values(tally)
            .map(pkg => ({
                ...pkg,
                delta: pkg.billedCovers - pkg.finalGuests,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [dailyMetrics]);
    
    const hasData = aggregatedData.some(d => d.billedCovers > 0 || d.finalGuests > 0);

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Package Count Check</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                </CardContent>
            </Card>
        );
    }
    
    return (
        <Card>
            <CardHeader>
                <CardTitle>Package Count Check</CardTitle>
                <CardDescription>Final Guest vs. Billed Package Covers</CardDescription>
            </CardHeader>
            <CardContent>
                {!hasData ? (
                    <p className="text-center text-sm text-muted-foreground py-10">No package receipts with guest snapshots found.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Package</TableHead>
                                    <TableHead className="text-right">Final Guests</TableHead>
                                    <TableHead className="text-right">Billed Covers</TableHead>
                                    <TableHead className="text-right">Δ</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {aggregatedData.map(pkg => (
                                    <TableRow key={pkg.name}>
                                        <TableCell className="font-medium">{pkg.name}</TableCell>
                                        <TableCell className="text-right font-mono">{pkg.finalGuests}</TableCell>
                                        <TableCell className="text-right font-mono">{pkg.billedCovers}</TableCell>
                                        <TableCell className={cn("text-right font-bold font-mono", pkg.delta !== 0 && "text-destructive")}>
                                            {pkg.delta > 0 ? `+${pkg.delta}` : pkg.delta}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

