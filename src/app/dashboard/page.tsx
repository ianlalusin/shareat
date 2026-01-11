
"use client";

import { useState, useEffect, useMemo } from "react";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { StatCards, type DashboardStats } from "@/components/dashboard/StatCards";
import { RecentSales, type Sale } from "@/components/dashboard/RecentSales";
import { PaymentMix, type PaymentMethodTally } from "@/components/dashboard/PaymentMix";
import { Loader2 } from "lucide-react";
import { collection, onSnapshot, query, where, Timestamp, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { Receipt } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";
import { TopCategoryCard } from "@/components/dashboard/top-category-card";
import { TopPackagesCard } from "@/components/dashboard/top-packages-card";
import { AvgRefillsCard } from "@/components/dashboard/avg-refills-card";
import { AvgServingTimeCard } from "@/components/dashboard/avg-serving-time-card";
import { PeakHoursCard } from "@/components/dashboard/peak-hours-card";
import { VoidedOrdersCard } from "@/components/dashboard/voided-orders-card";
import { PackageCountCheckCard } from "@/components/dashboard/package-count-check-card";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

export default function DashboardPage() {
    const { activeStore } = useStoreContext();
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // Default to today
    const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>({
        start: startOfDay(new Date()),
        end: endOfDay(new Date()),
    });

    useEffect(() => {
        if (!activeStore?.id) {
            setIsLoading(false);
            setReceipts([]);
            return;
        }

        setIsLoading(true);

        const receiptsRef = collection(db, "stores", activeStore.id, "receipts");
        const q = query(
            receiptsRef,
            where("status", "==", "final"),
            where("createdAt", ">=", Timestamp.fromDate(dateRange.start)),
            where("createdAt", "<=", Timestamp.fromDate(dateRange.end)),
            orderBy("createdAt", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedReceipts = snapshot.docs.map(doc => doc.data() as Receipt);
            setReceipts(fetchedReceipts);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching dashboard data:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [activeStore?.id, dateRange]);

    const { stats, recentSales, paymentTally, activeSessionsCount } = useMemo(() => {
        const v2Receipts = receipts.filter(r => r.analytics?.v === 2);
        
        const grossSales = v2Receipts.reduce((sum, r) => sum + (r.analytics?.grandTotal ?? 0), 0);
        const transactions = v2Receipts.length;
        const avgTicket = transactions > 0 ? grossSales / transactions : 0;
        
        const sales: Sale[] = v2Receipts.slice(0, 10).map(r => ({
            id: r.id,
            receiptNumber: r.receiptNumber,
            customerName: r.customerName,
            tableNumber: r.tableNumber,
            sessionMode: r.sessionMode,
            total: r.total,
            createdAtClientMs: r.createdAtClientMs
        }));

        const tally: PaymentMethodTally = {};
        v2Receipts.forEach(r => {
            const mop = r.analytics?.mop;
            if (mop) {
                for (const [method, amount] of Object.entries(mop)) {
                    tally[method] = (tally[method] || 0) + amount;
                }
            }
        });

        // This is a placeholder as we don't have live session counts here.
        // A more complex implementation would listen to the sessions collection.
        const activeSessionsCount = 0; 
        
        return {
            stats: { grossSales, transactions, avgTicket },
            recentSales: sales,
            paymentTally: tally,
            activeSessionsCount,
        };
    }, [receipts]);

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
    
    // Note: DateRangePicker component needs to be created or implemented
    // For now, we will just show a placeholder for the date picker
    return (
        <RoleGuard allow={["admin", "manager"]}>
            <PageHeader title="Dashboard" description={`Analytics for ${activeStore.name}`}>
                {/* <DateRangePicker /> */}
            </PageHeader>
            <div className="grid gap-6">
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    <StatCards stats={stats} activeSessions={activeSessionsCount} isLoading={isLoading} />
                </div>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-start">
                    <Card className="lg:col-span-1">
                        <CardHeader>
                            <CardTitle>Recent Sales</CardTitle>
                            <CardDescription>Top 10 most recent transactions.</CardDescription>
                        </CardHeader>
                        <CardContent>
                             <RecentSales sales={recentSales} storeId={activeStore.id} isLoading={isLoading} />
                        </CardContent>
                    </Card>
                    <Card className="lg:col-span-1">
                        <CardHeader>
                            <CardTitle>Payment Mix</CardTitle>
                            <CardDescription>Breakdown of payments by method.</CardDescription>
                        </CardHeader>
                        <CardContent>
                           <PaymentMix tally={paymentTally} isLoading={isLoading} />
                        </CardContent>
                    </Card>
                     <Card className="lg:col-span-1">
                        <TopPackagesCard receipts={receipts} isLoading={isLoading}/>
                    </Card>
                </div>
                 <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-start">
                    <PeakHoursCard storeId={activeStore.id} dateRange={dateRange} />
                    <AvgServingTimeCard storeId={activeStore.id} dateRange={dateRange} />
                    <AvgRefillsCard storeId={activeStore.id} dateRange={dateRange} />
                </div>
                 <div className="grid gap-6 md:grid-cols-1 items-start">
                     <TopCategoryCard receipts={receipts} isLoading={isLoading} />
                </div>
                 <div className="grid gap-6 md:grid-cols-2 items-start">
                    <VoidedOrdersCard storeId={activeStore.id} dateRange={dateRange} />
                    <PackageCountCheckCard storeId={activeStore.id} dateRange={dateRange} />
                </div>
            </div>
        </RoleGuard>
    );
}
