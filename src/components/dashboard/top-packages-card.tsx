
"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Receipt, ReceiptAnalyticsV2 } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TopPackagesCardProps {
    receipts: Receipt[];
    isLoading: boolean;
}

type ItemTally = {
    qty: number;
    amount: number;
};

export function TopPackagesCard({ receipts, isLoading }: TopPackagesCardProps) {
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [metric, setMetric] = useState<"qty" | "amount">("amount");
    
    const v2Receipts = useMemo(() => receipts.filter(r => r.analytics?.v === 2), [receipts]);

    const { itemSales, hasData } = useMemo(() => {
        const itemTally: Record<string, ItemTally> = {};
        let hasAnalyticsData = false;

        v2Receipts.forEach(receipt => {
            const analytics = receipt.analytics as ReceiptAnalyticsV2;
            if (analytics.salesByItem) {
                hasAnalyticsData = true;
                for (const [itemName, values] of Object.entries(analytics.salesByItem)) {
                    // Include ONLY items without a category or marked as 'Uncategorized'
                    if (!values.categoryName || values.categoryName === "Uncategorized") {
                        if (!itemTally[itemName]) itemTally[itemName] = { qty: 0, amount: 0 };
                        itemTally[itemName].qty += values.qty ?? 0;
                        itemTally[itemName].amount += values.amount ?? 0;
                    }
                }
            }
        });
        
        return { 
            itemSales: Object.entries(itemTally),
            hasData: hasAnalyticsData && Object.keys(itemTally).length > 0,
        };
    }, [v2Receipts]);
    
    const sortedItems = useMemo(() => {
        return itemSales.sort(([, a], [, b]) => {
            return metric === 'qty' ? b.qty - a.qty : b.amount - a.amount;
        });
    }, [itemSales, metric]);

    const topItems = sortedItems.slice(0, 8);

    if (isLoading) {
        return (
            <Card>
                <CardHeader><CardTitle>Top Packages</CardTitle></CardHeader>
                <CardContent><div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div></CardContent>
            </Card>
        );
    }
    
    if (!hasData) {
        return (
             <Card>
                <CardHeader><CardTitle>Top Packages</CardTitle></CardHeader>
                <CardContent><p className="text-center text-sm text-muted-foreground py-10">No package sales data for this period.</p></CardContent>
            </Card>
        )
    }

    return (
        <>
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Top Packages</CardTitle>
                        <CardDescription>Based on finalized receipts.</CardDescription>
                    </div>
                    <SheetTrigger asChild>
                        <Button variant="outline" size="sm" onClick={() => setIsSheetOpen(true)}>
                            View All Packages
                        </Button>
                    </SheetTrigger>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Package</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {topItems.map(([name, { qty, amount }]) => (
                            <TableRow key={name}>
                                <TableCell className="font-medium">{name}</TableCell>
                                <TableCell className="text-right">{qty.toLocaleString('en-US')}</TableCell>
                                <TableCell className="text-right">₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetContent className="w-full sm:max-w-lg flex flex-col">
                <SheetHeader>
                    <SheetTitle>All Package Sales</SheetTitle>
                    <SheetDescription>
                        Explore all package sales data for the selected period.
                    </SheetDescription>
                </SheetHeader>
                
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex justify-end py-4">
                        <Tabs value={metric} onValueChange={(v) => setMetric(v as any)} className="w-[180px]">
                            <TabsList className="grid w-full grid-cols-2 h-8">
                                <TabsTrigger value="amount" className="text-xs h-6">By Amount</TabsTrigger>
                                <TabsTrigger value="qty" className="text-xs h-6">By Quantity</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>
                    {sortedItems.length > 0 ? (
                        <ScrollArea className="flex-1">
                            <Table>
                                <TableHeader>
                                    <TableRow><TableHead>Package</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedItems.map(([name, { qty, amount }]) => (
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
                        <p className="text-center text-muted-foreground pt-10">No package sales data available.</p>
                    )}
                </div>
            </SheetContent>
        </Sheet>
        </>
    );
}
