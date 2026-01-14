

"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Receipt, ReceiptAnalyticsV2, DailyMetric } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TopCategoryCardProps {
    dailyMetrics: DailyMetric[];
    isLoading: boolean;
}

type CategoryTally = {
    amount: number;
};

export function TopCategoryCard({ dailyMetrics, isLoading }: TopCategoryCardProps) {
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    
    const { categorySales, hasData } = useMemo(() => {
        const categoryTally: Record<string, CategoryTally> = {};
        let hasAnalyticsData = false;

        dailyMetrics.forEach(metric => {
            if (metric.sales?.addonSalesAmountByCategory) {
                hasAnalyticsData = true;
                for (const [categoryName, amount] of Object.entries(metric.sales.addonSalesAmountByCategory)) {
                     if (!categoryTally[categoryName]) categoryTally[categoryName] = { amount: 0 };
                     categoryTally[categoryName].amount += amount;
                }
            }
        });
        
        return { 
            categorySales: Object.entries(categoryTally).sort(([, a], [, b]) => b.amount - a.amount), 
            hasData: hasAnalyticsData 
        };
    }, [dailyMetrics]);

    const topCategories = categorySales.slice(0, 8);

    if (isLoading) {
        return (
            <Card>
                <CardHeader><CardTitle>Top Add-on Categories</CardTitle></CardHeader>
                <CardContent><div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div></CardContent>
            </Card>
        );
    }
    
    if (!hasData || topCategories.length === 0) {
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
                        <Button variant="outline" size="sm" onClick={() => setIsSheetOpen(true)}>
                            View All
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Category</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {topCategories.map(([name, { amount }]) => (
                                <TableRow key={name}>
                                    <TableCell className="font-medium">{name}</TableCell>
                                    <TableCell className="text-right">₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <SheetContent className="w-full sm:max-w-lg flex flex-col">
                <SheetHeader>
                    <SheetTitle>All Add-on Category Sales</SheetTitle>
                    <SheetDescription>
                        Complete breakdown of add-on sales by category for the selected period.
                    </SheetDescription>
                </SheetHeader>
                <ScrollArea className="flex-1">
                    <Table>
                        <TableHeader>
                            <TableRow><TableHead>Category</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                            {categorySales.map(([name, { amount }]) => (
                                <TableRow key={name}>
                                    <TableCell className="font-medium">{name}</TableCell>
                                    <TableCell className="text-right">₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
}
