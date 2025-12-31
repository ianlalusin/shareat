
"use client";

import { useState, useEffect, useMemo } from "react";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { useStoreContext } from "@/context/store-context";
import { collection, query, where, onSnapshot, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Loader2 } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StatCards, type DashboardStats } from "@/components/dashboard/StatCards";
import { RecentSales, type Sale } from "@/components/dashboard/RecentSales";
import { PaymentMix, type PaymentMethodTally } from "@/components/dashboard/PaymentMix";
import { useAuthContext } from "@/context/auth-context";

export default function DashboardPage() {
    const { appUser } = useAuthContext();
    const { activeStore, loading: storeLoading } = useStoreContext();
    const [stats, setStats] = useState<DashboardStats>({ grossSales: 0, transactions: 0, avgTicket: 0 });
    const [activeSessions, setActiveSessions] = useState(0);
    const [recentSales, setRecentSales] = useState<Sale[]>([]);
    const [paymentTally, setPaymentTally] = useState<PaymentMethodTally>({});
    const [loadingData, setLoadingData] = useState(true);

    useEffect(() => {
        if (!activeStore) {
            setLoadingData(false);
            return;
        }
        setLoadingData(true);

        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);

        // Listener for today's receipts
        const receiptsQuery = query(
            collection(db, "stores", activeStore.id, "receipts"),
            where("createdAtClientMs", ">=", start.getTime()),
            where("createdAtClientMs", "<=", end.getTime()),
            orderBy("createdAtClientMs", "desc")
        );

        const unsubReceipts = onSnapshot(receiptsQuery, (snapshot) => {
            const receiptsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
            
            const getReceiptTotal = (r: any) => {
                const v = r?.analytics?.grandTotal ?? r?.total ?? 0;
                return typeof v === "number" ? v : Number(v) || 0;
            };

            const totalSales = receiptsData.reduce((sum, r) => sum + getReceiptTotal(r), 0);
            const totalTransactions = receiptsData.length;
            
            setStats({
                grossSales: totalSales,
                transactions: totalTransactions,
                avgTicket: totalTransactions > 0 ? totalSales / totalTransactions : 0,
            });

            setRecentSales(receiptsData.slice(0, 10).map(r => ({
                id: r.id,
                receiptNumber: r.receiptNumber,
                total: getReceiptTotal(r),
                customerName: r.customerName,
                tableNumber: r.tableNumber,
                sessionMode: r.sessionMode,
                createdAtClientMs: r.createdAtClientMs
            })));
            
            const tally: PaymentMethodTally = {};
            receiptsData.forEach(r => {
                if (r.analytics?.mop) {
                  for (const [method, amount] of Object.entries(r.analytics.mop)) {
                    tally[method] = (tally[method] || 0) + (amount as number);
                  }
                }
            });
            setPaymentTally(tally);
            
            setLoadingData(false);
        }, (error) => {
            console.error("Error fetching receipts:", error);
            setLoadingData(false);
        });

        // Listener for active sessions
        const sessionsQuery = query(
            collection(db, "stores", activeStore.id, "sessions"),
            where("status", "!=", "closed")
        );
        
        const unsubSessions = onSnapshot(sessionsQuery, (snapshot) => {
            setActiveSessions(snapshot.size);
        });

        return () => {
            unsubReceipts();
            unsubSessions();
        };
    }, [activeStore]);

    const isLoading = storeLoading || loadingData;

    if (!activeStore && !storeLoading) {
        return (
             <RoleGuard allow={["admin", "manager", "cashier", "server", "kitchen"]}>
                <PageHeader title="Dashboard" description="Select a store to view its performance." />
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-center text-muted-foreground">Please select a store from the dropdown in the header to get started.</p>
                    </CardContent>
                </Card>
            </RoleGuard>
        );
    }
    
    const canViewDashboard = appUser?.role && ['admin', 'manager', 'cashier'].includes(appUser.role);

    return (
        <RoleGuard allow={["admin", "manager", "cashier", "server", "kitchen"]}>
            <PageHeader title="Dashboard" description={activeStore ? `A real-time overview of ${activeStore.name}'s performance today.` : "Select a store to begin."} />
            
            {canViewDashboard ? (
                 <>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <StatCards stats={stats} activeSessions={activeSessions} isLoading={isLoading} />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                        <Card className="col-span-1 lg:col-span-4">
                            <CardHeader>
                                <CardTitle>Recent Sales</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <RecentSales sales={recentSales} storeId={activeStore?.id || ""} isLoading={isLoading} />
                            </CardContent>
                        </Card>
                        <Card className="col-span-1 lg:col-span-3">
                            <CardHeader>
                                <CardTitle>Payment Mix</CardTitle>
                                <CardDescription>A breakdown of payment methods used today.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <PaymentMix tally={paymentTally} isLoading={isLoading} />
                            </CardContent>
                        </Card>
                    </div>
                </>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle>Coming Soon</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-center text-muted-foreground py-10">A specialized dashboard for your role is coming soon.</p>
                    </CardContent>
                </Card>
            )}
        </RoleGuard>
    );
}
