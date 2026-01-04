
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    categoryName: string;
}

export function TopCategoryCard({ storeId, dateRange }: TopCategoryCardProps) {
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [metric, setMetric] = useState<"qty" | "amount">("amount");
    const [sheetTab, setSheetTab] = useState<'byCategory' | 'overall'>('byCategory');

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
        if (!selectedCategory || sheetTab !== 'byCategory') return { data: [], hasAnalytics: false };
        
        const tally: Record<string, ItemTally> = {};
        let hasItemAnalytics = false;

        receipts.forEach(receipt => {
            const salesByItem = receipt.analytics?.salesByItem;
            if (salesByItem && typeof salesByItem === 'object') {
                for (const [itemName, values] of Object.entries(salesByItem)) {
                    if (values.categoryName === selectedCategory) {
                        hasItemAnalytics = true;
                        if (!tally[itemName]) {
                            tally[itemName] = { qty: 0, amount: 0, categoryName: values.categoryName };
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
    }, [receipts, selectedCategory, metric, sheetTab]);

    const overallItems = useMemo(() => {
        if (sheetTab !== 'overall') return { data: [], hasAnalytics: false };

        const tally: Record<string, ItemTally> = {};
        let hasItemAnalytics = false;

        receipts.forEach(receipt => {
            const salesByItem = receipt.analytics?.salesByItem;
            if (salesByItem && typeof salesByItem === 'object') {
                hasItemAnalytics = true;
                 for (const [itemName, values] of Object.entries(salesByItem)) {
                    if (!tally[itemName]) {
                        tally[itemName] = { qty: 0, amount: 0, categoryName: values.categoryName };
                    }
                    tally[itemName].qty += values.qty || 0;
                    tally[itemName].amount += values.amount || 0;
                }
            }
        });
        
        const sorted = Object.entries(tally).sort(([, a], [, b]) => {
            return metric === 'qty' ? b.qty - a.qty : b.amount - a.amount;
        });
        
        return { data: sorted, hasAnalytics: hasItemAnalytics };

    }, [receipts, sheetTab, metric]);

    const handleCategoryClick = (categoryName: string) => {
        setSelectedCategory(categoryName);
        setSheetTab('byCategory');
        setIsSheetOpen(true);
    };

    const handleViewOverall = () => {
        setSelectedCategory(null);
        setSheetTab('overall');
        setIsSheetOpen(true);
    }
    
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
                    <Button variant="outline" size="sm" onClick={handleViewOverall}>
                        View All Items
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
            <SheetContent className="w-full sm:max-w-lg flex flex-col">
                <SheetHeader>
                    <SheetTitle>Sales Drilldown</SheetTitle>
                    <SheetDescription>
                        Explore sales by category or view all items.
                    </SheetDescription>
                </SheetHeader>
                
                <Tabs value={sheetTab} onValueChange={(value) => setSheetTab(value as any)} className="flex-1 flex flex-col overflow-hidden">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="byCategory">By Category</TabsTrigger>
                        <TabsTrigger value="overall">Overall Top Items</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="byCategory" className="flex-1 flex flex-col overflow-hidden">
                         <div className="flex justify-between items-center py-4">
                            <h3 className="font-semibold">{selectedCategory || "Select a Category"}</h3>
                            <Tabs value={metric} onValueChange={(v) => setMetric(v as any)} className="w-[180px]">
                                <TabsList className="grid w-full grid-cols-2 h-8">
                                    <TabsTrigger value="amount" className="text-xs h-6">By Amount</TabsTrigger>
                                    <TabsTrigger value="qty" className="text-xs h-6">By Quantity</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </div>
                        {selectedCategory ? (
                            aggregatedItems.hasAnalytics ? (
                                <ScrollArea className="flex-1">
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
                                </ScrollArea>
                            ) : (
                                <p className="text-center text-muted-foreground pt-10">No itemized sales data available for this category and period.</p>
                            )
                        ) : (
                            <p className="text-center text-muted-foreground pt-10">Select a category from the main dashboard to see item details.</p>
                        )}
                    </TabsContent>
                    
                    <TabsContent value="overall" className="flex-1 flex flex-col overflow-hidden">
                         <div className="flex justify-between items-center py-4">
                            <h3 className="font-semibold">Top Items (All Categories)</h3>
                            <Tabs value={metric} onValueChange={(v) => setMetric(v as any)} className="w-[180px]">
                                <TabsList className="grid w-full grid-cols-2 h-8">
                                    <TabsTrigger value="amount" className="text-xs h-6">By Amount</TabsTrigger>
                                    <TabsTrigger value="qty" className="text-xs h-6">By Quantity</TabsTrigger>
                                </TabsList>
                            </Tabs>
                         </div>
                        {overallItems.hasAnalytics ? (
                            <ScrollArea className="flex-1">
                                <Table>
                                    <TableHeader>
                                        <TableRow><TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {overallItems.data.map(([name, { qty, amount, categoryName }]) => (
                                            <TableRow key={name}>
                                                <TableCell className="font-medium">{name}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{categoryName}</TableCell>
                                                <TableCell className={cn("text-right", metric === 'qty' && 'font-bold')}>{qty}</TableCell>
                                                <TableCell className={cn("text-right", metric === 'amount' && 'font-bold')}>₱{amount.toFixed(2)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        ) : (
                             <p className="text-center text-muted-foreground pt-10">No itemized sales data available for this period.</p>
                        )}
                    </TabsContent>
                </Tabs>
            </SheetContent>
        </Sheet>
        </>
    );
}
