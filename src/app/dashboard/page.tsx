
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { useStoreContext } from "@/context/store-context";
import { collection, query, where, onSnapshot, orderBy, limit, doc, getDoc, getDocs, updateDoc, increment, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Loader2, Receipt, Users, BarChart, Printer } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthContext } from "@/context/auth-context";
import { ReceiptView, type ReceiptData } from "@/components/receipt/receipt-view";
import type { ModeOfPayment } from "@/lib/types";

// --- Sub-components for Dashboard ---

type DashboardStats = {
    totalSales: number;
    receiptsCount: number;
    avgBasket: number;
    discountsTotal: number;
};

const StatCard = ({ title, value, icon, isLoading, format = "number" }: { title: string, value: string | number, icon: React.ReactNode, isLoading: boolean, format?: "currency" | "number" }) => {
    const formattedValue = () => {
        if (isLoading) return <Skeleton className="h-8 w-3/4" />;
        if (typeof value === 'string') return value;
        if (format === 'currency') return `₱${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        return value.toLocaleString('en-US');
    };
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                {icon}
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{formattedValue()}</div>
            </CardContent>
        </Card>
    );
};

const PaymentMix = ({ tally, isLoading }: { tally: Record<string, number>, isLoading: boolean }) => {
    const sortedTally = useMemo(() => {
        return Object.entries(tally).sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
    }, [tally]);

    if (isLoading) return <Skeleton className="h-24 w-full" />;
    if (sortedTally.length === 0) return <p className="text-center text-sm text-muted-foreground py-10">No payment data for this period.</p>;
    
    return (
        <div className="space-y-2 text-sm">
            {sortedTally.map(([methodName, amount]) => (
                <div key={methodName} className="flex justify-between items-center">
                    <span className="font-medium capitalize">{methodName}</span>
                    <span className="text-muted-foreground">₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            ))}
        </div>
    );
};

type RecentReceipt = { id: string; receiptNumber?: string; customerName?: string | null; tableNumber?: string | null; sessionMode?: 'package_dinein' | 'alacarte'; total: number; createdAtClientMs: number; };

const RecentReceiptsList = ({ receipts, onSelect, isLoading, selectedId }: { receipts: RecentReceipt[], onSelect: (id: string) => void, isLoading: boolean, selectedId: string | null }) => {
    if (isLoading) return <Skeleton className="h-48 w-full" />;
    if (receipts.length === 0) return <p className="text-center text-sm text-muted-foreground py-10">No receipts for this period.</p>;
    return (
        <div className="space-y-2">
            {receipts.map((r) => {
                const primaryId = r.receiptNumber ?? (r.sessionMode === 'alacarte' ? r.customerName : `Table ${r.tableNumber}`);
                return (
                    <button key={r.id} onClick={() => onSelect(r.id)} className={`flex items-center w-full text-left p-2 rounded-md transition-colors ${selectedId === r.id ? 'bg-muted' : 'hover:bg-muted/50'}`}>
                        <div className="flex-1 space-y-1">
                            <p className="text-sm font-medium leading-none">{primaryId}</p>
                            <p className="text-sm text-muted-foreground">{format(new Date(r.createdAtClientMs), "p")}</p>
                        </div>
                        <div className="font-medium">₱{r.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </button>
                )
            })}
        </div>
    );
};

// --- Main Dashboard Page Component ---

type DatePreset = "today" | "yesterday" | "week" | "month";
const presets: { label: string, value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
];

function getUsername(appUser: any) {
    return (appUser?.displayName?.trim()) || (appUser?.name?.trim()) || (appUser?.email ? String(appUser.email).split("@")[0] : "") || (appUser?.uid ? String(appUser.uid).slice(0, 6) : "unknown");
}

export default function DashboardPage() {
    const { appUser } = useAuthContext();
    const { activeStore, loading: storeLoading } = useStoreContext();
    const [datePreset, setDatePreset] = useState<DatePreset>("today");
    
    const [receipts, setReceipts] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
    const [selectedReceiptData, setSelectedReceiptData] = useState<ReceiptData | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);

    // --- Data Fetching and Processing ---

    useEffect(() => {
        if (!activeStore?.id) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);

        const now = new Date();
        let start = new Date();
        let end = new Date();

        switch (datePreset) {
            case "today":
                start.setHours(0, 0, 0, 0);
                end.setHours(23, 59, 59, 999);
                break;
            case "yesterday":
                start.setDate(now.getDate() - 1);
                start.setHours(0, 0, 0, 0);
                end.setDate(now.getDate() - 1);
                end.setHours(23, 59, 59, 999);
                break;
            case "week":
                start.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
                start.setHours(0, 0, 0, 0);
                break;
            case "month":
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
        }

        const limitCount = datePreset === 'today' || datePreset === 'yesterday' ? 500 : 1500;

        const receiptsQuery = query(
            collection(db, "stores", activeStore.id, "receipts"),
            where("createdAtClientMs", ">=", start.getTime()),
            where("createdAtClientMs", "<=", end.getTime()),
            orderBy("createdAtClientMs", "desc"),
            limit(limitCount)
        );

        const unsubscribe = onSnapshot(receiptsQuery, (snapshot) => {
            setReceipts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setIsLoading(false);
            setError(null);
        }, (err) => {
            console.error("Dashboard receipt fetch error:", err);
            setError("Failed to load dashboard data.");
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [activeStore, datePreset]);

    const { stats, mopTotals, recentReceipts } = useMemo(() => {
        const getReceiptTotal = (r: any) => {
            const v = r?.analytics?.grandTotal ?? r?.total ?? 0;
            return typeof v === "number" ? v : Number(v) || 0;
        };

        const totalSales = receipts.reduce((sum, r) => sum + getReceiptTotal(r), 0);
        const discountsTotal = receipts.reduce((sum, r) => sum + (r.analytics?.discountsTotal || 0), 0);
        const receiptsCount = receipts.length;
        const avgBasket = receiptsCount > 0 ? totalSales / receiptsCount : 0;
        
        const mop: Record<string, number> = {};
        receipts.forEach(r => {
            const mopAny = r.analytics?.mop;
            if (!mopAny || typeof mopAny !== "object") return;
          
            for (const [methodKey, amount] of Object.entries(mopAny as Record<string, unknown>)) {
              const amt = typeof amount === "number" ? amount : Number(amount) || 0;
          
              const method =
                typeof amount === "object" && amount
                  ? String((amount as any).name ?? methodKey)
                  : methodKey;
          
              const finalMethod = method.trim() || methodKey;
              mop[finalMethod] = (mop[finalMethod] || 0) + amt;
            }
        });

        return {
            stats: { totalSales, receiptsCount, avgBasket, discountsTotal },
            mopTotals: mop,
            recentReceipts: receipts.slice(0, 10).map(r => ({
                id: r.id,
                receiptNumber: r.receiptNumber,
                total: getReceiptTotal(r),
                customerName: r.customerName,
                tableNumber: r.tableNumber,
                sessionMode: r.sessionMode,
                createdAtClientMs: r.createdAtClientMs
            }))
        };
    }, [receipts]);

    // --- Receipt Preview Logic ---

    const handleSelectReceipt = useCallback(async (receiptId: string) => {
        setSelectedReceiptId(receiptId);
        setIsLoadingPreview(true);
        setSelectedReceiptData(null);
        if (!activeStore?.id) return;
        
        try {
            const [sessionSnap, billablesSnap, paymentsSnap, settingsSnap, receiptSnap] = await Promise.all([
                getDoc(doc(db, "stores", activeStore.id, "sessions", receiptId)),
                getDocs(query(collection(db, "stores", activeStore.id, "sessions", receiptId, "billables"), orderBy("createdAt", "asc"))),
                getDocs(query(collection(db, "stores", activeStore.id, "sessions", receiptId, "payments"), orderBy("createdAt", "asc"))),
                getDoc(doc(db, "stores", activeStore.id, "receiptSettings", "main")),
                getDoc(doc(db, "stores", activeStore.id, "receipts", receiptId))
            ]);
            
            if (!receiptSnap.exists()) throw new Error("Receipt not found.");

            const receiptDocData = receiptSnap.data({ serverTimestamps: "estimate" }) as any;

            setSelectedReceiptData({
                session: sessionSnap.data() as any,
                billables: billablesSnap.docs.map(d => d.data()) as any[],
                payments: paymentsSnap.docs.map(d => d.data()) as any[],
                settings: settingsSnap.exists() ? settingsSnap.data() as any : {},
                receiptCreatedAt: receiptDocData.createdAt,
                createdByUsername: receiptDocData.createdByUsername,
                receiptNumber: receiptDocData.receiptNumber,
            });
        } catch (err) {
            console.error("Error loading receipt preview:", err);
        } finally {
            setIsLoadingPreview(false);
        }
    }, [activeStore?.id]);

    const handlePrint = async () => {
        if (!selectedReceiptData || !activeStore?.id || !appUser) return;
        setIsPrinting(true);
        window.requestAnimationFrame(async () => {
            window.print();
            try {
                const receiptRef = doc(db, `stores/${activeStore.id}/receipts`, selectedReceiptData.session.id);
                await updateDoc(receiptRef, {
                    printedCount: increment(1),
                    lastPrintedAt: serverTimestamp(),
                    lastPrintedByUid: appUser.uid,
                    lastPrintedByUsername: getUsername(appUser),
                });
            } catch (e) {
                console.warn("Print audit tracking failed:", e);
            } finally {
                setIsPrinting(false);
            }
        });
    };

    // --- Render Logic ---
    
    if (storeLoading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;
    }

    if (!activeStore) {
        return (
            <Card className="w-full max-w-md mx-auto text-center">
                <CardHeader><CardTitle>No Store Selected</CardTitle><CardDescription>Please select a store to view its dashboard.</CardDescription></CardHeader>
            </Card>
        );
    }
    
    const canViewDashboard = appUser?.role && ['admin', 'manager', 'cashier'].includes(appUser.role);

    return (
        <RoleGuard allow={["admin", "manager", "cashier", "server", "kitchen"]}>
            <div className="print:hidden">
                <PageHeader title="Dashboard" description={`Real-time overview of ${activeStore.name}'s performance.`}>
                    <div className="flex items-center gap-2 rounded-md bg-muted p-1">
                        {presets.map(p => (
                            <Button key={p.value} variant={datePreset === p.value ? 'default' : 'ghost'} size="sm" onClick={() => setDatePreset(p.value)} className="h-8">{p.label}</Button>
                        ))}
                    </div>
                </PageHeader>

                {!canViewDashboard ? (
                    <Card className="mt-6"><CardContent className="p-10 text-center text-muted-foreground">Dashboard widgets for your role are coming soon.</CardContent></Card>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                        <div className="lg:col-span-2 space-y-6">
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                                <StatCard title="Total Sales" value={stats.totalSales} icon={<span className="text-muted-foreground">₱</span>} isLoading={isLoading} format="currency" />
                                <StatCard title="Receipts" value={stats.receiptsCount} icon={<Receipt />} isLoading={isLoading} />
                                <StatCard title="Avg Basket" value={stats.avgBasket} icon={<BarChart />} isLoading={isLoading} format="currency" />
                                <StatCard title="Discounts Given" value={stats.discountsTotal} icon={<Users />} isLoading={isLoading} format="currency" />
                            </div>
                            <Card>
                                <CardHeader><CardTitle>Payment Mix</CardTitle></CardHeader>
                                <CardContent><PaymentMix tally={mopTotals} isLoading={isLoading} /></CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle>Recent Receipts</CardTitle></CardHeader>
                                <CardContent><RecentReceiptsList receipts={recentReceipts} onSelect={handleSelectReceipt} isLoading={isLoading} selectedId={selectedReceiptId} /></CardContent>
                            </Card>
                        </div>
                        <div className="lg:col-span-1">
                            <Card className="sticky top-20">
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle>Receipt Preview</CardTitle>
                                    <Button onClick={handlePrint} disabled={!selectedReceiptData || isPrinting} size="sm">
                                        {isPrinting ? <Loader2 className="mr-2 animate-spin" /> : <Printer className="mr-2" />} Print
                                    </Button>
                                </CardHeader>
                                <CardContent className="bg-muted/30 p-2 min-h-[500px]">
                                    {isLoadingPreview ? (
                                        <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-muted-foreground" /></div>
                                    ) : selectedReceiptData ? (
                                        <div id="print-receipt-area-dashboard"><ReceiptView data={selectedReceiptData} /></div>
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-muted-foreground"><p>Select a receipt to preview.</p></div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                )}
                 {error && <Card className="mt-6"><CardContent className="p-10 text-center text-destructive">{error}</CardContent></Card>}
            </div>
            <div className="hidden print-block">
                {selectedReceiptData && <ReceiptView data={selectedReceiptData} />}
            </div>
        </RoleGuard>
    );
}
