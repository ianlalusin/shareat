

"use client";

import { useState, useEffect, useMemo } from "react";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCards, type DashboardStats } from "@/components/dashboard/StatCards";
import { PaymentMix } from "@/components/dashboard/PaymentMix";
import { Loader2 } from "lucide-react";
import { collection, onSnapshot, query, where, Timestamp, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { TopCategoryCard } from "@/components/dashboard/top-category-card";
import { TopPackagesCard } from "@/components/dashboard/top-packages-card";
import { AvgRefillsCard } from "@/components/dashboard/avg-refills-card";
import { AvgServingTimeCard } from "@/components/dashboard/avg-serving-time-card";
import { PeakHoursCard } from "@/components/dashboard/peak-hours-card";
import { PackageCountCheckCard } from "@/components/dashboard/package-count-check-card";
import type { DailyMetric } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}
function isSameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

type DatePreset = "today" | "yesterday" | "week" | "month" | "custom";
const presets: { label: string, value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
];

function customBtnLabel(range: {start: Date; end: Date} | null, active: boolean) {
    if (!active || !range) return "Custom";
    return isSameDay(range.start, range.end)
        ? `Custom: ${fmtDate(range.start)}`
        : `Custom: ${fmtDate(range.start)} — ${fmtDate(range.end)}`;
}


export default function DashboardPage() {
    const { activeStore } = useStoreContext();
    const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeSessionsCount, setActiveSessionsCount] = useState(0);
    
    const [datePreset, setDatePreset] = useState<DatePreset>("today");
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);

     const { start, end } = useMemo(() => {
        const now = new Date();
        let s = new Date();
        let e = new Date();

        switch (datePreset) {
            case "today":
                s.setHours(0, 0, 0, 0);
                e.setHours(23, 59, 59, 999);
                break;
            case "yesterday":
                s.setDate(now.getDate() - 1);
                s.setHours(0, 0, 0, 0);
                e.setDate(now.getDate() - 1);
                e.setHours(23, 59, 59, 999);
                break;
            case "week":
                s.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
                s.setHours(0, 0, 0, 0);
                break;
            case "month":
                s = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case "custom":
                if (customRange) {
                    s = startOfDay(customRange.start);
                    e = endOfDay(customRange.end);
                } else {
                    s.setHours(0, 0, 0, 0);
                    e.setHours(23, 59, 59, 999);
                }
                break;
        }
        return { start: s, end: e };
    }, [datePreset, customRange]);

    const dateRangeLabel = useMemo(() => {
        if (isSameDay(start, end)) {
            return fmtDate(start);
        }
        return `${fmtDate(start)} - ${fmtDate(end)}`;
    }, [start, end]);

    const handleCalendarChange = (range: { start: Date; end: Date }, preset: string | null) => {
        const presetMap: Record<string, DatePreset> = {
          today: "today", yesterday: "yesterday", lastWeek: "week", lastMonth: "month",
        };
        if (preset && preset !== "custom" && presetMap[preset]) {
          setDatePreset(presetMap[preset]);
          setCustomRange(null);
        } else {
          setCustomRange({ start: range.start, end: range.end });
          setDatePreset("custom");
        }
        setIsCalendarOpen(false);
    };

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
        const startMs = start.getTime();
        const endMs = end.getTime();

        const metricsQuery = query(
            metricsRef,
            where("meta.dayStartMs", ">=", startMs),
            where("meta.dayStartMs", "<=", endMs),
            orderBy("meta.dayStartMs", "asc")
        );
        unsubs.push(onSnapshot(metricsQuery, (snapshot) => {
            setDailyMetrics(snapshot.docs.map(doc => doc.data() as DailyMetric));
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching daily metrics:", error);
            setIsLoading(false);
        }));

        // --- Active Sessions Count ---
        const sessionsRef = collection(db, "stores", activeStore.id, "sessions");
        const activeSessionsQuery = query(sessionsRef, where("status", "in", ["active", "pending_verification"]));
        unsubs.push(onSnapshot(activeSessionsQuery, (snapshot) => {
            setActiveSessionsCount(snapshot.size);
        }, (error) => console.error("Error fetching active sessions:", error)));

        return () => unsubs.forEach(unsub => unsub());
    }, [activeStore?.id, start, end]);


    const stats = useMemo<DashboardStats>(() => {
        if (!dailyMetrics || dailyMetrics.length === 0) {
            return { grossSales: 0, transactions: 0, avgBasket: 0 };
        }
        
        const grossSales = dailyMetrics.reduce((sum, metric) => sum + (metric.payments?.totalGross || 0), 0);
        const transactions = dailyMetrics.reduce((sum, metric) => sum + (metric.payments?.txCount || 0), 0);
        const avgBasket = transactions > 0 ? grossSales / transactions : 0;
        
        return { grossSales, transactions, avgBasket };
    }, [dailyMetrics]);

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
                    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-1">
                        {presets.map(p => (
                            <Button key={p.value} variant={datePreset === p.value ? 'default' : 'ghost'} size="sm" onClick={() => { setDatePreset(p.value); setCustomRange(null); }} className="h-8">{p.label}</Button>
                        ))}
                        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                            <PopoverTrigger asChild>
                                <Button variant={datePreset === "custom" ? "default" : "ghost"} size="sm" className="h-8 min-w-[100px]">{customBtnLabel(customRange, datePreset === "custom")}</Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0"><CompactCalendar onChange={handleCalendarChange}/></PopoverContent>
                        </Popover>
                    </div>
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
                    <AvgServingTimeCard dailyMetrics={dailyMetrics} isLoading={isLoading} />
                    <AvgRefillsCard storeId={activeStore.id} dateRange={{ start, end }} />
                </div>
            </div>
        </RoleGuard>
    );
}
