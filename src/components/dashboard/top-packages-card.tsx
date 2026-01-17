
"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DailyMetric } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TopPackagesCardProps {
    dailyMetrics: DailyMetric[];
    isLoading: boolean;
}

type ItemTally = {
    qty: number;
    amount: number;
};

export function TopPackagesCard({ dailyMetrics, isLoading }: TopPackagesCardProps) {
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [metric, setMetric] = useState<"qty" | "amount">("amount");
    
    const { itemSales, hasData } = useMemo(() => {
        const itemTally: Record<string, ItemTally> = {};
        let hasAnalyticsData = false;

        dailyMetrics.forEach(metric => {
            const salesMapAmount = metric.sales?.packageSalesAmountByName ?? {};
            const salesMapQty = metric.sales?.packageSalesQtyByName ?? {};

            if (Object.keys(salesMapAmount).length > 0 || Object.keys(salesMapQty).length > 0) {
                hasAnalyticsData = true;
            }

            for (const [name, amount] of Object.entries(salesMapAmount)) {
                if (!itemTally[name]) itemTally[name] = { qty: 0, amount: 0 };
                itemTally[name].amount += amount;
            }
            
            for (const [name, qty] of Object.entries(salesMapQty)) {
                if (!itemTally[name]) itemTally[name] = { qty: 0, amount: 0 };
                itemTally[name].qty += qty;
            }
        });
        
        return { 
            itemSales: Object.entries(itemTally),
            hasData: hasAnalyticsData
        };
    }, [dailyMetrics]);
    
    const sortedItems = useMemo(() => {
        return itemSales.sort(([, a], [, b]) => {
            return metric === 'qty' ? b.qty - a.qty : b.amount - a.amount;
        });
    }, [itemSales, metric]);

    const topItems = sortedItems.slice(0, 5);

    if (isLoading) {
        return (
            <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Top Packages</CardTitle></CardHeader>
                <CardContent><div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div></CardContent>
            </Card>
        );
    }
    
    if (!hasData) {
        return (
             <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Top Packages</CardTitle></CardHeader>
                <CardContent><p className="text-center text-sm text-muted-foreground py-10">No package sales data for this period.</p></CardContent>
            </Card>
        )
    }

    return (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex justify-between items-center">
                        <CardTitle className="text-base">Top Packages</CardTitle>
                        <Button variant="outline" size="sm" onClick={() => setIsSheetOpen(true)}>
                            View All
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                     <div className="text-xs text-muted-foreground text-center">
                        Based on finalized receipts.
                    </div>
                     <div className="space-y-2">
                        {topItems.map(([name, { qty, amount }]) => (
                            <div key={name} className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-sm">{name}</div>
                                    <div className="text-xs text-muted-foreground">{qty.toLocaleString('en-US')} sold</div>
                                </div>
                                <div className="shrink-0 text-sm font-medium tabular-nums">
                                    ₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
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
    );
}
