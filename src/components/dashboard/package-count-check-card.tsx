
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
        
        dailyMetrics.forEach(metric => {
            // Aggregate final guests
            const coversByPkgName = metric.guests?.guestCountFinalByPackageName ?? {};
            for(const [pkgName, guests] of Object.entries(coversByPkgName)) {
                if (!tally[pkgName]) {
                    tally[pkgName] = { name: pkgName, finalGuests: 0, billedCovers: 0 };
                }
                tally[pkgName].finalGuests += guests;
            }

            // Aggregate billed covers
            const coversByPkg = metric.guests?.packageCoversBilledByPackageName ?? {};
            for(const [pkgName, covers] of Object.entries(coversByPkg)) {
                if (!tally[pkgName]) {
                    tally[pkgName] = { name: pkgName, finalGuests: 0, billedCovers: 0 };
                }
                tally[pkgName].billedCovers += covers;
            }
        });

        return Object.values(tally)
            .map(pkg => ({
                ...pkg,
                delta: pkg.billedCovers - pkg.finalGuests,
            }))
            .sort((a, b) => b.billedCovers - a.billedCovers);
    }, [dailyMetrics]);
    
    const hasData = aggregatedData.some(d => d.billedCovers > 0 || d.finalGuests > 0);

    if (isLoading) {
        return (
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Package Count Check</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                </CardContent>
            </Card>
        );
    }
    
    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base">Package Count Check</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">
                    Final Guests vs. Billed Covers
                </div>
                {!hasData ? (
                    <p className="text-center text-sm text-muted-foreground py-10">No package receipts with guest snapshots found.</p>
                ) : (
                    <div className="space-y-2">
                        {aggregatedData.map(pkg => (
                            <div key={pkg.name} className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-sm">{pkg.name}</div>
                                </div>
                                <div className="shrink-0 text-sm font-medium tabular-nums text-right">
                                    <div>{pkg.billedCovers} billed / {pkg.finalGuests} guests</div>
                                    <div className={cn("text-xs", pkg.delta !== 0 ? "text-destructive" : "text-muted-foreground")}>
                                        Δ {pkg.delta > 0 ? `+${pkg.delta}` : pkg.delta}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
