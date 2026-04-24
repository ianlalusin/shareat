
"use client";

import { useState } from "react";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCards } from "@/components/dashboard/StatCards";
import { PaymentMix } from "@/components/dashboard/PaymentMix";
import { PaymentConvertModal } from "@/components/dashboard/PaymentConvertModal";
import { Loader2, AlertTriangle, Printer, ArrowRightLeft } from "lucide-react";
import { useAuthContext } from "@/context/auth-context";
import { PrintSalesReportDialog } from "@/components/dashboard/PrintSalesReportDialog";
import { TopCategoryCard } from "@/components/dashboard/top-category-card";
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
import { DiscountsChargesCard } from "@/components/dashboard/discounts-charges-card";
import { WeeklySalesChart } from "@/components/dashboard/WeeklySalesChart";
import { useWeatherLogger } from "@/hooks/useWeatherLogger";
import { WeatherLoggerModal } from "@/components/shared/WeatherLoggerModal";
import { ForecastAccuracyTrendCard } from "@/components/dashboard/ForecastAccuracyTrendCard";
import { TodayForecastCard } from "@/components/dashboard/TodayForecastCard";
import { WeatherLogFloatingButton } from "@/components/dashboard/WeatherLogFloatingButton";
import { useForecastAnalytics } from "@/hooks/useForecastAnalytics";
import { ItemAdjustmentsCard } from "@/components/dashboard/ItemAdjustmentsCard";
import { useToast } from "@/hooks/use-toast";
import { getAuth } from "firebase/auth";

import { isSameDay, fmtDate } from "@/lib/utils/date";
function customBtnLabel(range: {start: Date; end: Date} | null, active: boolean) {
    if (!active || !range) return "Custom";
    return isSameDay(range.start, range.end)
        ? `Custom: ${fmtDate(range.start)}`
        : `Custom: ${fmtDate(range.start)} — ${fmtDate(range.end)}`;
}

const presets: { label: string, value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "Last 7 Days", value: "last7" },
    { label: "This Month", value: "month" },
    { label: "Last Month", value: "lastMonth" },
    { label: "YTD", value: "ytd" },
];


export default function DashboardPageClient() {
    const { activeStore } = useStoreContext();
    const { appUser } = useAuthContext();
    const [reportDialogOpen, setReportDialogOpen] = useState(false);
    const [convertModalOpen, setConvertModalOpen] = useState(false);
    const [datePreset, setDatePreset] = useState<DatePreset>("today");
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);

    const { isModalOpen, closeModal } = useWeatherLogger();
    const { toast } = useToast();
    const [isRefreshingForecast, setIsRefreshingForecast] = useState(false);
    const [forecastRefreshKey, setForecastRefreshKey] = useState(0);

    const isAdmin = appUser?.isPlatformAdmin || appUser?.role === "admin";

    const handleRefreshForecast = async () => {
        if (!activeStore?.id) return;
        setIsRefreshingForecast(true);
        try {
            const idToken = await getAuth().currentUser?.getIdToken();
            if (!idToken) throw new Error("Not authenticated.");
            const res = await fetch("/api/admin/refresh-forecast", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ storeId: activeStore.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Refresh failed.");
            toast({ title: "Forecast refreshed", description: `${data.forecastsWritten ?? 0} days updated.` });
            setForecastRefreshKey((k) => k + 1);
        } catch (err: any) {
            toast({ title: "Forecast refresh failed", description: err.message, variant: "destructive" });
        } finally {
            setIsRefreshingForecast(false);
        }
    };

    const {
        isLoading,
        dateRangeLabel,
        stats,
        activeSessions,
        paymentMix,
        dailyMetrics,
        topCategories,
        warnings,
        topRefills,
        topAddonItems,
        hasTopAddonItems,
    } = useDashboardAnalytics({
        storeId: activeStore?.id,
        preset: datePreset,
        customRange,
    });
    
    const {
        accuracy,
        todaysProjectedSales,
        todaysConfidence,
        isLoading: isForecastLoading
    } = useForecastAnalytics(activeStore?.id, activeStore ?? undefined);
    
    const handleCalendarChange = (range: { start: Date; end: Date }, preset: string | null) => {
        const presetMap: Record<string, DatePreset> = {
          today: "today", 
          yesterday: "yesterday", 
          lastWeek: "week", 
          lastMonth: "lastMonth",
          last7: "last7",
          last30: "last30",
          month: "month",
          ytd: "ytd"
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
        <RoleGuard allow={["admin", "manager", "cashier"]}>
            <PageHeader title="Dashboard" description={`Analytics for ${activeStore.name}`} className="mb-4">
                 <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-4">
                        {(appUser?.role === "cashier" || appUser?.role === "manager" || appUser?.isPlatformAdmin) && (
                            <Button variant="outline" size="sm" className="h-8" onClick={() => setReportDialogOpen(true)}>
                                <Printer className="mr-2 h-4 w-4" />
                                Print Sales Report
                            </Button>
                        )}
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

                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    <StatCards stats={stats} activeSessions={activeSessions} isLoading={isLoading} />
                </div>
                
                 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                    <div className="lg:col-span-2 space-y-6">
                      <WeeklySalesChart storeId={activeStore.id} refreshKey={forecastRefreshKey} />
                       <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <ForecastAccuracyTrendCard storeId={activeStore.id} />
                        <TodayForecastCard
                          projectedSales={todaysProjectedSales}
                          confidence={todaysConfidence}
                          actualSalesToday={stats?.netSales ?? null}
                          isLoading={isForecastLoading}
                          isAdmin={isAdmin}
                          onRefresh={handleRefreshForecast}
                          isRefreshing={isRefreshingForecast}
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
                        <PeakHoursCard dailyMetrics={dailyMetrics} isLoading={isLoading} />
                        <ItemAdjustmentsCard dailyMetrics={dailyMetrics} />
                      </div>
                    </div>
                    <div className="space-y-6">
                      <Card>
                          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                              <CardTitle className="text-base">Payment Mix</CardTitle>
                              {(appUser?.role === "admin" || appUser?.role === "manager" || appUser?.isPlatformAdmin) && (
                                  <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7"
                                      onClick={() => setConvertModalOpen(true)}
                                  >
                                      <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
                                      Convert
                                  </Button>
                              )}
                          </CardHeader>
                          <CardContent><PaymentMix data={paymentMix} isLoading={isLoading} /></CardContent>
                      </Card>
                      <DiscountsChargesCard dailyMetrics={dailyMetrics} isLoading={isLoading} />
                      <PackageCountCheckCard dailyMetrics={dailyMetrics} isLoading={isLoading} />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
                    <TopCategoryCard 
                        categorySales={topCategories}
                        topAddonItems={topAddonItems}
                        hasTopAddonItems={hasTopAddonItems}
                        dailyMetrics={dailyMetrics}
                        isLoading={isLoading} 
                    />
                    <AvgServingTimeCard dailyMetrics={dailyMetrics} isLoading={isLoading} />
                    <TopRefillsCard 
                        dailyMetrics={dailyMetrics} 
                        isLoading={isLoading} 
                        topRefills={topRefills} 
                    />
                </div>
            </div>

            {activeStore?.id && (
                <WeatherLoggerModal 
                    isOpen={isModalOpen}
                    onClose={closeModal}
                    storeId={activeStore.id}
                />
            )}
            
            {activeStore?.id && (
                <WeatherLogFloatingButton storeId={activeStore.id} />
            )}

            <PrintSalesReportDialog open={reportDialogOpen} onOpenChange={setReportDialogOpen} />

            {activeStore?.id && (
                <PaymentConvertModal
                    open={convertModalOpen}
                    onOpenChange={setConvertModalOpen}
                    storeId={activeStore.id}
                    knownMethods={Object.keys(paymentMix || {})}
                />
            )}
        </RoleGuard>
    );
}
