
"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Receipt, ReceiptAnalyticsV2 } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TopCategoryCardProps {
    receipts: Receipt[];
    isLoading: boolean;
}

type CategoryTally = {
    qty: number;
    amount: number;
};
type ItemTally = {
    qty: number;
    amount: number;
    categoryName: string;
};

export function TopCategoryCard({ receipts, isLoading }: TopCategoryCardProps) {
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [metric, setMetric] = useState<"qty" | "amount">("amount");
    const [sheetTab, setSheetTab] = useState<'byCategory' | 'overall'>('byCategory');
    
    const v2Receipts = useMemo(() => receipts.filter(r => r.analytics?.v === 2), [receipts]);

    const { categorySales, itemSales } = useMemo(() => {
        const categoryTally: Record<string, CategoryTally> = {};
        const itemTally: Record<string, ItemTally> = {};
        let hasAnalyticsData = false;

        v2Receipts.forEach(receipt => {
            const analytics = receipt.analytics as ReceiptAnalyticsV2;
            if (analytics.salesByCategory) {
                hasAnalyticsData = true;
                for (const [categoryName, values] of Object.entries(analytics.salesByCategory)) {
                    if (categoryName === "Uncategorized") continue; // Exclude packages
                    if (!categoryTally[categoryName]) categoryTally[categoryName] = { qty: 0, amount: 0 };
                    categoryTally[categoryName].qty += values.qty ?? 0;
                    categoryTally[categoryName].amount += values.amount ?? 0;
                }
            }
             if (analytics.salesByItem) {
                hasAnalyticsData = true;
                for (const [itemName, values] of Object.entries(analytics.salesByItem)) {
                    if (!values.categoryName || values.categoryName === "Uncategorized") continue; // Exclude packages
                    
                    if (!itemTally[itemName]) itemTally[itemName] = { qty: 0, amount: 0, categoryName: values.categoryName };
                    itemTally[itemName].qty += values.qty ?? 0;
                    itemTally[itemName].amount += values.amount ?? 0;
                }
            }
        });
        
        return { 
            categorySales: { 
                data: Object.entries(categoryTally).sort(([, a], [, b]) => b.amount - a.amount), 
                hasAnalytics: hasAnalyticsData 
            },
            itemSales: itemTally
        };
    }, [v2Receipts]);
    
    const aggregatedItems = useMemo(() => {
        if (!selectedCategory || sheetTab !== 'byCategory') return { data: [] };
        
        const filtered = Object.entries(itemSales).filter(([, item]) => item.categoryName === selectedCategory);
        
        const sorted = filtered.sort(([, a], [, b]) => {
            return metric === 'qty' ? b.qty - a.qty : b.amount - a.amount;
        });

        return { data: sorted };
    }, [itemSales, selectedCategory, metric, sheetTab]);

    const overallItems = useMemo(() => {
        if (sheetTab !== 'overall') return { data: [] };

        const sorted = Object.entries(itemSales).sort(([, a], [, b]) => {
            return metric === 'qty' ? b.qty - a.qty : b.amount - a.amount;
        });
        
        return { data: sorted };

    }, [itemSales, sheetTab, metric]);

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
                <CardHeader><CardTitle>Top Add-on Categories</CardTitle></CardHeader>
                <CardContent><div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div></CardContent>
            </Card>
        );
    }
    
    if (!categorySales.hasAnalytics || topCategories.length === 0) {
        return (
             <Card>
                <CardHeader><CardTitle>Top Add-on Categories</CardTitle></CardHeader>
                <CardContent><p className="text-center text-sm text-muted-foreground py-10">No add-on sales data for this period.</p></CardContent>
            </Card>
        )
    }

    return (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>Top Add-on Categories</CardTitle>
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
                                    <TableCell className="text-right">{qty.toLocaleString('en-US')}</TableCell>
                                    <TableCell className="text-right">₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <SheetContent className="w-full sm:max-w-lg flex flex-col">
                <SheetHeader>
                    <SheetTitle>Add-on Sales Drilldown</SheetTitle>
                    <SheetDescription>
                        Explore sales by category or view all add-on items.
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
                            aggregatedItems.data.length > 0 ? (
                                <ScrollArea className="flex-1">
                                <Table>
                                    <TableHeader>
                                        <TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {aggregatedItems.data.map(([name, { qty, amount }]) => (
                                            <TableRow key={name}>
                                                <TableCell className="font-medium">{name}</TableCell>
                                                <TableCell className={cn("text-right", metric === 'qty' && 'font-bold')}>{qty.toLocaleString('en-US')}</TableCell>
                                                <TableCell className={cn("text-right", metric === 'amount' && 'font-bold')}>₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
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
                        {overallItems.data.length > 0 ? (
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
                                                <TableCell className={cn("text-right", metric === 'qty' && 'font-bold')}>{qty.toLocaleString('en-US')}</TableCell>
                                                <TableCell className={cn("text-right", metric === 'amount' && 'font-bold')}>₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
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
    );
}

    
