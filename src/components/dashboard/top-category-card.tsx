
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Receipt } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TopCategoryCardProps {
    storeId: string;
    dateRange: { start: Date; end: Date };
}

type CategoryTally = {
    qty: number;
    amount: number;
};

type ItemTally = {
    qty: number;
    amount: number;
}

export function TopCategoryCard({ storeId, dateRange }: TopCategoryCardProps) {
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // State for drilldown
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [metric, setMetric] = useState<"qty" | "amount">("amount");

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
            console.error("Error fetching category sales:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [storeId, dateRange]);

    const categorySales = useMemo(() => {
        const tally: Record<string, CategoryTally> = {};
        let hasAnalyticsData = false;

        receipts.forEach(receipt => {
            const salesByCategory = receipt.analytics?.salesByCategory;
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
        return { data: sortedTally, hasAnalytics: hasAnalyticsData };
    }, [receipts]);
    
    const aggregatedItems = useMemo(() => {
        if (!selectedCategory) return { data: [], hasAnalytics: false };
        
        const tally: Record<string, ItemTally> = {};
        let hasItemAnalytics = false;

        receipts.forEach(receipt => {
            const salesByItem = receipt.analytics?.salesByItem;
            if (salesByItem && typeof salesByItem === 'object') {
                for (const [itemName, values] of Object.entries(salesByItem)) {
                    if (values.categoryName === selectedCategory) {
                        hasItemAnalytics = true;
                        if (!tally[itemName]) {
                            tally[itemName] = { qty: 0, amount: 0 };
                        }
                        tally[itemName].qty += values.qty || 0;
                        tally[itemName].amount += values.amount || 0;
                    }
                }
            }
        });

        const sorted = Object.entries(tally).sort(([, a], [, b]) => {
            return metric === 'qty' ? b.qty - a.qty : b.amount - a.amount;
        });

        return { data: sorted, hasAnalytics: hasItemAnalytics };
    }, [receipts, selectedCategory, metric]);

    const handleCategoryClick = (categoryName: string) => {
        setSelectedCategory(categoryName);
        setIsSheetOpen(true);
    };
    
    const topCategories = categorySales.data.slice(0, 8);

    if (isLoading) {
        return (
            <Card>
                <CardHeader><CardTitle>Top Categories</CardTitle></CardHeader>
                <CardContent><div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div></CardContent>
            </Card>
        );
    }
    
    if (!categorySales.hasAnalytics) {
        return (
             <Card>
                <CardHeader><CardTitle>Top Categories</CardTitle></CardHeader>
                <CardContent><p className="text-center text-sm text-muted-foreground py-10">No category analytics yet for this period (new receipts only).</p></CardContent>
            </Card>
        )
    }

    return (
        <>
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Top Categories</CardTitle>
                        <CardDescription>Based on finalized receipts.</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleCategoryClick("All")}>
                        View All
                    </Button>
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
                            <TableRow key={name} className="cursor-pointer" onClick={() => handleCategoryClick(name)}>
                                <TableCell className="font-medium">{name}</TableCell>
                                <TableCell className="text-right">{qty}</TableCell>
                                <TableCell className="text-right">₱{amount.toFixed(2)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetContent className="sm:max-w-lg">
                <SheetHeader>
                    <SheetTitle>{selectedCategory === "All" ? "All Categories" : `${selectedCategory} - Top Items`}</SheetTitle>
                     <SheetDescription>
                        {selectedCategory === "All" ? "Sales summary for all categories." : "Items sorted by sales within this category."}
                    </SheetDescription>
                </SheetHeader>
                {selectedCategory !== "All" && (
                    <Tabs value={metric} onValueChange={(v) => setMetric(v as any)} className="my-4">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="amount">By Amount</TabsTrigger>
                            <TabsTrigger value="qty">By Quantity</TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}
                
                {selectedCategory === "All" ? (
                    <Table>
                        <TableHeader>
                            <TableRow><TableHead>Category</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                            {categorySales.data.map(([name, { qty, amount }]) => (
                                <TableRow key={name}><TableCell>{name}</TableCell><TableCell className="text-right">{qty}</TableCell><TableCell className="text-right">₱{amount.toFixed(2)}</TableCell></TableRow>
                            ))}
                        </TableBody>
                    </Table>
                ) : aggregatedItems.hasAnalytics ? (
                    <Table>
                        <TableHeader>
                            <TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                             {aggregatedItems.data.map(([name, { qty, amount }]) => (
                                <TableRow key={name}>
                                    <TableCell className="font-medium">{name}</TableCell>
                                    <TableCell className={cn("text-right", metric === 'qty' && 'font-bold')}>{qty}</TableCell>
                                    <TableCell className={cn("text-right", metric === 'amount' && 'font-bold')}>₱{amount.toFixed(2)}</TableCell>
                                </TableRow>
                             ))}
                        </TableBody>
                    </Table>
                ) : (
                    <p className="text-center text-muted-foreground pt-10">No itemized sales data available for this category and period.</p>
                )}
            </SheetContent>
        </Sheet>
        </>
    );
}

