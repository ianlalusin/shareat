"use client";

import { useState, useEffect } from "react";
import { collection, query, where, onSnapshot, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight } from "lucide-react";
import type { Receipt } from "@/lib/types";

interface TopCategoryCardProps {
    storeId: string;
    dateRange: { start: Date; end: Date };
}

type CategoryTally = {
    qty: number;
    amount: number;
};

export function TopCategoryCard({ storeId, dateRange }: TopCategoryCardProps) {
    const [categorySales, setCategorySales] = useState<[string, CategoryTally][]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSheetOpen, setIsSheetOpen] = useState(false);

    useEffect(() => {
        if (!storeId) {
            setIsLoading(false);
            setCategorySales([]);
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
            const tally: Record<string, CategoryTally> = {};
            let hasAnalyticsData = false;

            snapshot.forEach(doc => {
                const data = doc.data() as Receipt;
                const salesByCategory = data.analytics?.salesByCategory;

                if (salesByCategory && typeof salesByCategory === 'object') {
                    hasAnalyticsData = true;
                    for (const [categoryName, values] of Object.entries(salesByCategory)) {
                        if (!tally[categoryName]) {
                            tally[categoryName] = { qty: 0, amount: 0 };
                        }
                        tally[categoryName].qty += values.qty || 0;
                        tally[categoryName].amount += values.amount || 0;
                    }
                }
            });

            const sortedTally = Object.entries(tally).sort(([, a], [, b]) => b.amount - a.amount);
            
            // Only update state if there was data to process.
            if (hasAnalyticsData) {
                setCategorySales(sortedTally);
            } else {
                setCategorySales([]);
            }
            
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching category sales:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [storeId, dateRange]);

    const topCategories = categorySales.slice(0, 8);

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Top Categories</CardTitle>
                    <CardDescription>Based on finalized receipts.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                </CardContent>
            </Card>
        );
    }
    
    if (categorySales.length === 0) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle>Top Categories</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-center text-sm text-muted-foreground py-10">No category analytics yet for this period (new receipts only).</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Top Categories</CardTitle>
                        <CardDescription>Based on finalized receipts.</CardDescription>
                    </div>
                    <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="sm">
                                View All
                            </Button>
                        </SheetTrigger>
                        <SheetContent>
                            <SheetHeader>
                                <SheetTitle>All Category Sales</SheetTitle>
                            </SheetHeader>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Category</TableHead>
                                        <TableHead className="text-right">Qty</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {categorySales.map(([name, { qty, amount }]) => (
                                        <TableRow key={name}>
                                            <TableCell className="font-medium">{name}</TableCell>
                                            <TableCell className="text-right">{qty}</TableCell>
                                            <TableCell className="text-right">₱{amount.toFixed(2)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </SheetContent>
                    </Sheet>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {topCategories.map(([name, { qty, amount }]) => (
                            <TableRow key={name}>
                                <TableCell className="font-medium">{name}</TableCell>
                                <TableCell className="text-right">{qty}</TableCell>
                                <TableCell className="text-right">₱{amount.toFixed(2)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
