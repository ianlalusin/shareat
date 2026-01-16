
"use client";

import { useState } from "react";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCards } from "@/components/dashboard/StatCards";
import { PaymentMix } from "@/components/dashboard/PaymentMix";
import { Loader2, AlertTriangle } from "lucide-react";
import { TopCategoryCard } from "@/components/dashboard/top-category-card";
import { TopPackagesCard } from "@/components/dashboard/top-packages-card";
import { AvgRefillsCard } from "@/components/dashboard/avg-refills-card";
import { AvgServingTimeCard } from "@/components/dashboard/avg-serving-time-card";
import { PeakHoursCard } from "@/components/dashboard/peak-hours-card";
import { PackageCountCheckCard } from "@/components/dashboard/package-count-check-card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";
import { useDashboardAnalytics, type DatePreset } from "@/hooks/use-dashboard-analytics";
import { MonthlySalesTrendChart } from "@/components/dashboard/MonthlySalesTrendChart";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TopRefillsCard } from "@/components/dashboard/top-refills-card";
import { TopAddonItemsCard } from "@/components/dashboard/top-addon-items-card";

function isSameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}
function customBtnLabel(range: {start: Date; end: Date} | null, active: boolean) {
    if (!active || !range) return "Custom";
    return isSameDay(range.start, range.end)
        ? `Custom: ${fmtDate(range.start)}`
        : `Custom: ${fmtDate(range.start)} — ${fmtDate(range.end)}`;
}

const presets: { label: string, value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
];


export default function DashboardPage() {
    const { activeStore } = useStoreContext();
    const [datePreset, setDatePreset] = useState<DatePreset>("today");
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);
    const [showYtd, setShowYtd] = useState(false);

    const {
        isLoading,
        dateRangeLabel,
        dateRange,
        stats,
        activeSessions,
        paymentMix,
        dailyMetrics,
        topCategories,
        ytdData,
        trendRows,
        warnings
    } = useDashboardAnalytics({
        storeId: activeStore?.id,
        preset: datePreset,
        customRange,
        ytdMode: showYtd,
    });
    
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
                    <div className="flex items-center gap-4">
                        <div className="flex items-center space-x-2">
                            <Switch id="ytd-toggle" checked={showYtd} onCheckedChange={setShowYtd} />
                            <Label htmlFor="ytd-toggle">YTD Compare</Label>
                        </div>
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
                    </div>
                    <p className="text-sm text-muted-foreground w-full md:w-auto text-right">{dateRangeLabel}</p>
                </div>
            </PageHeader>
            <div className="grid gap-6">
                
                {warnings && warnings.length > 0 && (
                    <RoleGuard allow={['admin', 'manager']}>
                        <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Data Integrity Warning</AlertTitle>
                            <AlertDescription>
                                <ul className="list-disc pl-5">
                                    {warnings.map((warning, i) => <li key={i}>{warning}</li>)}
                                </ul>
                            </AlertDescription>
                        </Alert>
                    </RoleGuard>
                )}

                {showYtd ? (
                    <>
                        <MonthlySalesTrendChart data={trendRows} isLoading={isLoading} />
                        <Card>
                            <CardHeader><CardTitle>YTD Performance vs. Previous Year</CardTitle></CardHeader>
                            <CardContent className="grid gap-6 md:grid-cols-2">
                                <div className="space-y-4">
                                    <h3 className="font-semibold text-lg text-center">This Year</h3>
                                    <StatCards stats={ytdData.cur} activeSessions={activeSessions} isLoading={isLoading} />
                                    <PaymentMix data={ytdData.cur.mop} isLoading={isLoading} />
                                </div>
                                <div className="space-y-4">
                                     <h3 className="font-semibold text-lg text-center">Last Year</h3>
                                     <StatCards stats={ytdData.prev} isLoading={isLoading} />
                                     <PaymentMix data={ytdData.prev.mop} isLoading={isLoading} />
                                </div>
                            </CardContent>
                        </Card>
                    </>
                ) : (
                    <>
                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                            <StatCards stats={stats} activeSessions={activeSessions} isLoading={isLoading} />
                        </div>
                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-start">
                            <Card className="lg:col-span-1">
                                <CardHeader className="pb-3"><CardTitle className="text-base">Payment Mix</CardTitle></CardHeader>
                                <CardContent><PaymentMix data={paymentMix} isLoading={isLoading} /></CardContent>
                            </Card>
                            <div className="lg:col-span-2 space-y-6">
                                <PackageCountCheckCard dailyMetrics={dailyMetrics} isLoading={isLoading} />
                            </div>
                        </div>
                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-start">
                            <Card className="lg:col-span-1"><TopPackagesCard dailyMetrics={dailyMetrics} isLoading={isLoading}/></Card>
                            <div className="lg:col-span-2"><TopCategoryCard categorySales={topCategories} isLoading={isLoading} /></div>
                        </div>
                         <div className="grid gap-6 md:grid-cols-3 items-start">
                            <PeakHoursCard dailyMetrics={dailyMetrics} isLoading={isLoading} />
                            <TopAddonItemsCard storeId={activeStore.id} dailyMetrics={dailyMetrics} isLoading={isLoading} topN={5} />
                            <TopRefillsCard storeId={activeStore.id} dateRange={dateRange} isLoading={isLoading} topN={5} />
                        </div>
                        <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3 items-start">
                           <div className="lg:col-span-2">
                             <AvgServingTimeCard dailyMetrics={dailyMetrics} isLoading={isLoading} />
                           </div>
                        </div>
                    </>
                )}
            </div>
        </RoleGuard>
    );
}
