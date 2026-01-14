

"use client";

import { useState, useEffect, useMemo } from "react";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { StatCards, type DashboardStats } from "@/components/dashboard/StatCards";
import { PaymentMix } from "@/components/dashboard/PaymentMix";
import { Loader2 } from "lucide-react";
import { collection, onSnapshot, query, where, Timestamp, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { Receipt } from "@/lib/types";
import { TopCategoryCard } from "@/components/dashboard/top-category-card";
import { TopPackagesCard } from "@/components/dashboard/top-packages-card";
import { AvgRefillsCard } from "@/components/dashboard/avg-refills-card";
import { AvgServingTimeCard } from "@/components/dashboard/avg-serving-time-card";
import { PeakHoursCard } from "@/components/dashboard/peak-hours-card";
import { PackageCountCheckCard } from "@/components/dashboard/package-count-check-card";
import { isSameDay, format as formatDateFns } from "date-fns";
import type { DailyMetric } from "@/lib/types";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default function DashboardPage() {
    const { activeStore } = useStoreContext();
    const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeSessionsCount, setActiveSessionsCount] = useState(0);
    
    const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>({
        start: startOfDay(new Date()),
        end: endOfDay(new Date()),
    });

    useEffect(() => {
        if (!activeStore?.id) {
            setIsLoading(false);
            setDailyMetrics([]);
            return;
        }

        setIsLoading(true);
        const unsubs: (() => void)[] = [];

        // --- Daily Metrics for aggregated data ---
        const metricsRef = collection(db, "stores", activeStore.id, "analytics");
        const dateRangeIds: string[] = [];
        let currentDate = new Date(dateRange.start);
        while (currentDate <= dateRange.end) {
            dateRangeIds.push(getDayIdFromTimestamp(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        if (dateRangeIds.length > 0) {
            const metricsQuery = query(metricsRef, where("dayId", "in", dateRangeIds));
            unsubs.push(onSnapshot(metricsQuery, (snapshot) => {
                setDailyMetrics(snapshot.docs.map(doc => doc.data() as DailyMetric));
            }, (error) => console.error("Error fetching daily metrics:", error)));
        } else {
             setDailyMetrics([]);
        }

        // --- Active Sessions Count ---
        const sessionsRef = collection(db, "stores", activeStore.id, "sessions");
        const activeSessionsQuery = query(sessionsRef, where("status", "in", ["active", "pending_verification"]));
        unsubs.push(onSnapshot(activeSessionsQuery, (snapshot) => {
            setActiveSessionsCount(snapshot.size);
        }, (error) => console.error("Error fetching active sessions:", error)));

        const timer = setTimeout(() => setIsLoading(false), 1500); 
        unsubs.push(() => clearTimeout(timer));

        return () => unsubs.forEach(unsub => unsub());
    }, [activeStore?.id, dateRange]);


    const stats = useMemo<DashboardStats>(() => {
        if (!dailyMetrics || dailyMetrics.length === 0) {
            return { grossSales: 0, transactions: 0, avgBasket: 0 };
        }
        
        const grossSales = dailyMetrics.reduce((sum, metric) => sum + (metric.payments?.totalGross || 0), 0);
        const transactions = dailyMetrics.reduce((sum, metric) => sum + (metric.payments?.txCount || 0), 0);
        const avgBasket = transactions > 0 ? grossSales / transactions : 0;
        
        return { grossSales, transactions, avgBasket };
    }, [dailyMetrics]);


    const dateRangeLabel = useMemo(() => {
        if (isSameDay(dateRange.start, dateRange.end)) {
            return fmtDate(dateRange.start);
        }
        return `${fmtDate(dateRange.start)} - ${fmtDate(dateRange.end)}`;
    }, [dateRange]);

    if (!activeStore) {
        return (
            <Card className="w-full max-w-md mx-auto mt-10">
                <CardHeader>
                    <CardTitle>No Store Selected</CardTitle>
                    <CardDescription>Please select a store from the dropdown in the header to view the dashboard.</CardDescription>
                </CardHeader>
            </Card>
        );
    }
    
    return (
        <RoleGuard allow={["admin", "manager", "cashier", "server"]}>
            <PageHeader title="Dashboard" description={`Analytics for ${activeStore.name}`} className="mb-4">
                 <div className="flex flex-col items-end gap-2">
                    <DateRangePicker 
                        onDateChange={(range) => setDateRange({start: startOfDay(range.start), end: endOfDay(range.end)})}
                    />
                    <p className="text-sm text-muted-foreground w-full md:w-auto text-right">{dateRangeLabel}</p>
                </div>
            </PageHeader>
            <div className="grid gap-6">
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    <StatCards stats={stats} activeSessions={activeSessionsCount} isLoading={isLoading} />
                </div>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-start">
                     <Card className="lg:col-span-1">
                        <CardHeader>
                            <CardTitle>Payment Mix</CardTitle>
                            <CardDescription>Breakdown of payments by method.</CardDescription>
                        </CardHeader>
                        <CardContent>
                           <PaymentMix dailyMetrics={dailyMetrics} isLoading={isLoading} />
                        </CardContent>
                    </Card>
                    <div className="lg:col-span-2 space-y-6">
                      <PackageCountCheckCard dailyMetrics={dailyMetrics} isLoading={isLoading} />
                    </div>
                </div>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-start">
                     <Card className="lg:col-span-1">
                        <TopPackagesCard dailyMetrics={dailyMetrics} isLoading={isLoading}/>
                    </Card>
                     <div className="lg:col-span-2">
                       <TopCategoryCard dailyMetrics={dailyMetrics} isLoading={isLoading} />
                    </div>
                </div>
                 <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-start">
                    <PeakHoursCard dailyMetrics={dailyMetrics} isLoading={isLoading} />
                    <AvgServingTimeCard storeId={activeStore.id} dateRange={dateRange} />
                    <AvgRefillsCard storeId={activeStore.id} dateRange={dateRange} />
                </div>
            </div>
        </RoleGuard>
    );
}
