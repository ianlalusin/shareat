
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy, Timestamp, limit } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Receipt, ReceiptAnalyticsV2 } from "@/lib/types";

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
            where("createdAt", "<=", Timestamp.fromDate(dateRange.end)),
            orderBy("createdAt", "desc"),
            limit(2000)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            setReceipts(snapshot.docs.map(doc => doc.data() as Receipt));
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching package count analytics:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [storeId, dateRange]);

    const aggregatedData = useMemo(() => {
        const tally: Record<string, PackageTally> = {};

        receipts.forEach(receipt => {
            const snapshot = receipt.analytics?.guestCountSnapshot;
            if (!snapshot) return;

            const key = snapshot.packageOfferingId || snapshot.packageName || "unknown";
            const name = snapshot.packageName || "Unknown Package";

            if (!tally[key]) {
                tally[key] = { name, finalGuests: 0, billedCovers: 0 };
            }
            
            tally[key].finalGuests += snapshot.finalGuestCount || 0;
            tally[key].billedCovers += snapshot.billedPackageCovers || 0;
        });

        return Object.values(tally)
            .map(pkg => ({
                ...pkg,
                delta: pkg.billedCovers - pkg.finalGuests,
            }))
            .sort((a, b) => {
                const deltaDiff = Math.abs(b.delta) - Math.abs(a.delta);
                if (deltaDiff !== 0) return deltaDiff;
                return a.name.localeCompare(b.name);
            });
    }, [receipts]);

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
    
    const hasDiscrepancy = aggregatedData.some(d => d.delta !== 0);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Package Count Check</CardTitle>
                <CardDescription>Final Guest vs. Billed Package Covers</CardDescription>
            </CardHeader>
            <CardContent>
                {aggregatedData.length === 0 ? (
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
                         {!hasDiscrepancy && <p className="text-center text-sm text-green-600 mt-4">All package counts match.</p>}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
