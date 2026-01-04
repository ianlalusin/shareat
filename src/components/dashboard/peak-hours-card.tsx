
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Zap } from "lucide-react";
import { toJsDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface PeakHoursCardProps {
    storeId: string;
    dateRange: { start: Date; end: Date };
}

type Receipt = {
    createdAt: any;
    analytics?: { v?: number; grandTotal?: number };
    total?: number;
}

export function PeakHoursCard({ storeId, dateRange }: PeakHoursCardProps) {
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAllHours, setShowAllHours] = useState(false);

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
            // Filter for v2 analytics client-side to avoid needing a new index
            setReceipts(fetchedReceipts.filter(r => r.analytics?.v === 2));
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching peak hours data:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [storeId, dateRange]);

    const hourlyData = useMemo(() => {
        const salesByHour = Array(24).fill(0);
        const countByHour = Array(24).fill(0);

        receipts.forEach(receipt => {
            const date = toJsDate(receipt.createdAt);
            if (date) {
                const hour = date.getHours();
                const amount = receipt.analytics?.grandTotal ?? receipt.total ?? 0;
                salesByHour[hour] += amount;
                countByHour[hour] += 1;
            }
        });

        const maxSale = Math.max(...salesByHour);
        const peakHourIndex = salesByHour.indexOf(maxSale);

        const data = salesByHour.map((sales, hour) => ({
            hour,
            sales,
            count: countByHour[hour],
            isPeak: false,
        }));
        
        // Find top 3 hours
        const sortedBySales = [...data].sort((a, b) => b.sales - a.sales);
        const top3Hours = new Set(sortedBySales.slice(0, 3).map(d => d.hour));
        data.forEach(d => {
            if (top3Hours.has(d.hour)) d.isPeak = true;
        });

        return {
            processedData: data,
            peakHour: data[peakHourIndex],
            totalReceipts: receipts.length,
            maxSale
        };
    }, [receipts]);
    
    const formatHour = (hour: number) => {
        if (hour === 0) return "12 AM";
        if (hour === 12) return "12 PM";
        if (hour < 12) return `${hour} AM`;
        return `${hour - 12} PM`;
    };

    const businessHoursData = useMemo(() => {
        return hourlyData.processedData.filter(d => (d.hour >= 8 && d.hour <= 23) || d.count > 0);
    }, [hourlyData.processedData]);

    const dataToDisplay = showAllHours ? hourlyData.processedData : businessHoursData;

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Peak Hours</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                </CardContent>
            </Card>
        );
    }
    
    if (hourlyData.totalReceipts === 0) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle>Peak Hours</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-center text-sm text-muted-foreground py-10">No receipts in this range.</p>
                </CardContent>
            </Card>
        )
    }
    
    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle>Peak Hours</CardTitle>
                        <CardDescription>Sales distribution by hour of the day.</CardDescription>
                    </div>
                     <div className="flex items-center space-x-2">
                        <Label htmlFor="show-all-hours">Show All</Label>
                        <Switch id="show-all-hours" checked={showAllHours} onCheckedChange={setShowAllHours} />
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="mb-4 text-center">
                    <p className="text-sm text-muted-foreground">Peak Hour</p>
                    <p className="text-lg font-bold">
                        {formatHour(hourlyData.peakHour.hour)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        ₱{hourlyData.peakHour.sales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} • {hourlyData.peakHour.count} receipts
                    </p>
                </div>
                <div className="space-y-2 text-xs">
                    {dataToDisplay.map(({ hour, sales, count, isPeak }) => {
                        const widthPercent = hourlyData.maxSale > 0 ? (sales / hourlyData.maxSale) * 100 : 0;
                        if (!showAllHours && count === 0) return null;
                        
                        return (
                            <div key={hour} className="flex items-center gap-2">
                                <div className="w-12 text-muted-foreground">{formatHour(hour)}</div>
                                <div className="flex-1 h-6 bg-muted rounded-sm overflow-hidden relative">
                                    <div 
                                        className={cn(
                                            "h-full absolute left-0 top-0 transition-all",
                                            isPeak ? "bg-primary/80" : "bg-primary/40"
                                        )} 
                                        style={{ width: `${widthPercent}%` }}
                                    />
                                    <div className="absolute inset-0 px-2 flex justify-between items-center z-10">
                                         <span className={cn("font-medium", widthPercent > 30 ? 'text-primary-foreground' : 'text-foreground')}>{count}</span>
                                        <span className={cn("font-semibold", widthPercent > 70 ? 'text-primary-foreground' : 'text-foreground')}>
                                            ₱{sales > 0 ? sales.toLocaleString() : ''}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

