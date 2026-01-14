

"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy, Timestamp, limit } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyMetric } from "@/lib/types";

interface PackageCountCheckCardProps {
    dailyMetrics: DailyMetric[];
    isLoading: boolean;
}

type PackageTally = {
    name: string;
    finalGuests: number;
    billedCovers: number;
};

export function PackageCountCheckCard({ dailyMetrics, isLoading }: PackageCountCheckCardProps) {

    const aggregatedData = useMemo(() => {
        const tally: Record<string, PackageTally> = {};
        let totalGuestsForPeriod = 0;

        dailyMetrics.forEach(metric => {
            totalGuestsForPeriod += metric.guests?.guestCountFinalTotal || 0;

            if (!metric.guests?.packageCoversBilledByPackageName) return;

            for (const [name, covers] of Object.entries(metric.guests.packageCoversBilledByPackageName)) {
                if (!tally[name]) {
                    tally[name] = { name, finalGuests: 0, billedCovers: 0 };
                }
                tally[name].billedCovers += covers;
            }
        });

        // Distribute total guests across packages based on their proportion of billed covers
        const totalBilledCovers = Object.values(tally).reduce((sum, pkg) => sum + pkg.billedCovers, 0);
        
        if (totalBilledCovers > 0) {
            for(const key in tally) {
                const proportion = tally[key].billedCovers / totalBilledCovers;
                tally[key].finalGuests = Math.round(totalGuestsForPeriod * proportion);
            }
        }
        
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
