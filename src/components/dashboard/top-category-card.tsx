
"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DailyMetric, TopAddonRow } from "@/lib/types";

type CategoryData = {
    categoryName: string;
    qty: number;
    amount: number;
};

interface TopAddonsCardProps {
    categorySales: CategoryData[];
    topAddonItems: TopAddonRow[];
    hasTopAddonItems: boolean;
    dailyMetrics: DailyMetric[];
    isLoading: boolean;
}

function fmtCurrency(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `₱${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


export function TopCategoryCard({ categorySales, topAddonItems, hasTopAddonItems, dailyMetrics, isLoading }: TopAddonsCardProps) {
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    
    const hasData = categorySales && categorySales.length > 0;
    const topCategories = hasData ? categorySales.slice(0, 5) : [];

    const totalAddonSales = useMemo(() => {
        let total = 0;
        (dailyMetrics || []).forEach((m) => {
          const byCat = m?.sales?.addonSalesAmountByCategory ?? {};
          for (const v of Object.values(byCat)) total += Number(v ?? 0);
        });
        return total;
    }, [dailyMetrics]);

    if (isLoading) {
        return (
            <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Top Add-ons</CardTitle></CardHeader>
                <CardContent><div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div></CardContent>
            </Card>
        );
    }
    
    if (!hasData) {
        return (
             <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Top Add-ons</CardTitle></CardHeader>
                <CardContent><p className="text-center text-sm text-muted-foreground py-10">No add-on sales data for this period.</p></CardContent>
            </Card>
        )
    }

    return (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex justify-between items-center">
                        <CardTitle className="text-base">Top Add-ons</CardTitle>
                        <Button variant="outline" size="sm" onClick={() => setIsSheetOpen(true)}>
                            View All
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                     <div className="text-xs text-muted-foreground text-center">
                        Total add-on sales: <span className="font-medium text-foreground">{fmtCurrency(totalAddonSales)}</span>
                    </div>
                    <div className="space-y-2">
                        {topCategories.map(({ categoryName, qty, amount }) => (
                           <div key={categoryName} className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-sm">{categoryName}</div>
                                    <div className="text-xs text-muted-foreground">{qty.toLocaleString('en-US')} items</div>
                                </div>
                                <div className="shrink-0 text-sm font-medium tabular-nums">
                                    {fmtCurrency(amount)}
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
            <SheetContent className="w-full sm:max-w-lg flex flex-col">
                <SheetHeader>
                    <SheetTitle>All Add-on Sales</SheetTitle>
                    <SheetDescription>
                        Breakdown of add-on sales for the selected period.
                    </SheetDescription>
                </SheetHeader>
                <Tabs defaultValue="category" className="w-full mt-4 flex-1 flex flex-col">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="category">By Category</TabsTrigger>
                        <TabsTrigger value="item">By Item</TabsTrigger>
                    </TabsList>
                    <TabsContent value="category" className="flex-1 overflow-hidden">
                        <ScrollArea className="h-full">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Category</TableHead>
                                        <TableHead className="text-right">Qty</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {categorySales.map(({ categoryName, qty, amount }) => (
                                        <TableRow key={categoryName}>
                                            <TableCell className="font-medium">{categoryName}</TableCell>
                                            <TableCell className="text-right">{qty.toLocaleString()}</TableCell>
                                            <TableCell className="text-right">{fmtCurrency(amount)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    </TabsContent>
                    <TabsContent value="item" className="flex-1 overflow-hidden">
                        <ScrollArea className="h-full">
                             {hasTopAddonItems ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Item</TableHead>
                                            <TableHead className="text-right">Qty</TableHead>
                                            <TableHead className="text-right">Amount</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {topAddonItems.map((item, idx) => (
                                            <TableRow key={`${item.name}-${idx}`}>
                                                <TableCell>
                                                    <div className="font-medium">{item.name}</div>
                                                    <div className="text-xs text-muted-foreground">{item.categoryName}</div>
                                                </TableCell>
                                                <TableCell className="text-right">{item.qty.toLocaleString()}</TableCell>
                                                <TableCell className="text-right">{fmtCurrency(item.amount)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <div className="text-sm text-center text-muted-foreground pt-10">Top item data is not available for custom date ranges.</div>
                            )}
                        </ScrollArea>
                    </TabsContent>
                </Tabs>
            </SheetContent>
        </Sheet>
    );
}
