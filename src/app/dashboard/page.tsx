

"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { useStoreContext } from "@/context/store-context";
import { collection, query, where, onSnapshot, orderBy, limit, doc, getDoc, getDocs, updateDoc, increment, serverTimestamp, Timestamp, QueryDocumentSnapshot, DocumentData, startAfter } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Loader2, Receipt, Users, ShoppingBasket, Percent, Printer, XIcon, Download } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthContext } from "@/context/auth-context";
import { ReceiptView, type ReceiptData as BaseReceiptData } from "@/components/receipt/receipt-view";
import type { ModeOfPayment, Receipt as ReceiptType, BillableLine, ReceiptAnalyticsV2 } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { VoidedOrdersCard } from "@/components/dashboard/voided-orders-card";
import { TopCategoryCard } from "@/components/dashboard/top-category-card";
import { AvgServingTimeCard } from "@/components/dashboard/avg-serving-time-card";
import { AvgRefillsCard } from "@/components/dashboard/avg-refills-card";
import { PeakHoursCard } from "@/components/dashboard/peak-hours-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";
import { useRouter } from "next/navigation";


// --- HELPERS ---
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function isSameDay(a: Date, b: Date) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function fmtDate(d: Date) { return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }); }
function customBtnLabel(range: {start: Date; end: Date} | null, active: boolean) {
    if (!active || !range) return "Custom";
    return isSameDay(range.start, range.end)
        ? `Custom: ${fmtDate(range.start)}`
        : `Custom: ${fmtDate(range.start)} — ${fmtDate(range.end)}`;
}


const StatCard = ({ title, value, icon, isLoading, format = "number", children }: { title: string, value: string | number, icon: React.ReactNode, isLoading: boolean, format?: "currency" | "number", children?: React.ReactNode }) => {
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
                {children}
            </CardContent>
        </Card>
    );
};

const PaymentMix = ({ tally, isLoading, activeMop, onMopSelect }: { tally: Record<string, number>, isLoading: boolean, activeMop: string | null, onMopSelect: (mop: string) => void }) => {
    const sortedTally = useMemo(() => {
        return Object.entries(tally).sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
    }, [tally]);

    if (isLoading) return <Skeleton className="h-24 w-full" />;
    if (sortedTally.length === 0) return <p className="text-center text-sm text-muted-foreground py-10">No payment data for this period.</p>;
    
    return (
        <div className="space-y-1 text-sm">
            {sortedTally.map(([methodName, amount]) => (
                <button 
                    key={methodName} 
                    className={`flex justify-between items-center w-full p-1.5 rounded-md text-left transition-colors ${activeMop === methodName ? 'bg-muted' : 'hover:bg-muted/50'}`}
                    onClick={() => onMopSelect(methodName)}
                >
                    <span className="font-medium capitalize">{methodName}</span>
                    <span className="text-muted-foreground">₱{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </button>
            ))}
        </div>
    );
};


// --- Main Dashboard Page Component ---

type DatePreset = "today" | "yesterday" | "week" | "month" | "custom";
const presets: { label: string, value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
];
const PAGE_SIZE = 15;

function getUsername(appUser: any) {
    return (appUser?.displayName?.trim()) || (appUser?.name?.trim()) || (appUser?.email ? String(appUser.email).split("@")[0] : "") || (appUser?.uid ? String(appUser.uid).slice(0, 6) : "unknown");
}

const toNum = (v: any) => (typeof v === 'number' ? v : Number(v) || 0);


function csvEscape(val: any) {
    const s = val == null ? "" : String(val);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function formatLocal(dtMs?: number) {
    if (!dtMs) return "";
    return new Date(dtMs).toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function mopToString(mop: any) {
    if (!mop || typeof mop !== "object") return "";
    const parts: string[] = [];
    for (const [k, v] of Object.entries(mop)) {
        const amt = toNum(v);
        if (!k) continue;
        parts.push(`${k}:${amt}`);
    }
    return parts.join("|");
}

// Extend the base receipt data type for the dashboard's needs
type ReceiptData = BaseReceiptData & {
  analytics?: any;
};


export default function DashboardPage() {
    const router = useRouter();
    const { appUser } = useAuthContext();
    const { activeStore, loading: storeLoading } = useStoreContext();
    const [datePreset, setDatePreset] = useState<DatePreset>("today");
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);
    
    // State for all receipts in the date range (for stats)
    const [rangeReceiptsAll, setRangeReceiptsAll] = useState<ReceiptType[]>([]);
    const [isStatsLoading, setIsStatsLoading] = useState(true);
    
    const [error, setError] = useState<string | null>(null);

    // Filter states
    const [search, setSearch] = useState("");
    const [activeMop, setActiveMop] = useState<string | null>(null);
    

    // --- Data Fetching and Processing ---
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

    // Listener for ALL receipts in the range (for stats)
    useEffect(() => {
        if (!activeStore?.id) {
            setIsStatsLoading(false);
            return;
        }
        setIsStatsLoading(true);

        const qAll = query(
            collection(db, "stores", activeStore.id, "receipts"),
            where("createdAt", ">=", start),
            where("createdAt", "<=", end)
        );

        const unsub = onSnapshot(qAll, (snap) => {
            const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as ReceiptType));
            setRangeReceiptsAll(all);
            setIsStatsLoading(false);
        }, (err) => {
            console.error("Stats receipts listener failed:", err);
            setRangeReceiptsAll([]);
            setIsStatsLoading(false);
        });

        return () => unsub();
    }, [activeStore?.id, start, end]);

    const applyFilters = useCallback((list: ReceiptType[]) => {
        return list.filter(r => {
            if (activeMop) {
                const mopData = r.analytics?.mop;
                if (!mopData || typeof mopData !== 'object' || !(activeMop in mopData) || !((mopData as any)[activeMop] > 0)) {
                    return false;
                }
            }
            // other filters if any
            return true;
        });
    }, [activeMop]);
    
    // Derived list for stats calculation
    const statsReceipts = useMemo(() => applyFilters(rangeReceiptsAll), [rangeReceiptsAll, applyFilters]);
    
    const { stats, mopTotals } = useMemo(() => {
        const finalReceipts = statsReceipts.filter(r => r.status === 'final');

        let totalSales = 0;
        let discountsTotal = 0;
        const mop: Record<string, number> = {};

        finalReceipts.forEach(r => {
            const analytics = r.analytics as ReceiptAnalyticsV2;
            if (!analytics || typeof analytics !== 'object') {
                 // Legacy fallback
                 totalSales += toNum(r.total);
                 return;
            }

            totalSales += toNum(analytics.grandTotal);
            discountsTotal += toNum(analytics.discountsTotal);
            
            const netMop = { ...(analytics.mop || {}) };
            const change = toNum(analytics.change);
            
            if (change > 0) {
                const cashKey = Object.keys(netMop).find(k => k.toLowerCase().includes('cash'));
                if (cashKey && toNum(netMop[cashKey]) > 0) {
                    netMop[cashKey] = Math.max(0, toNum(netMop[cashKey]) - change);
                }
            }

            for (const [methodKey, amount] of Object.entries(netMop)) {
                const amt = toNum(amount);
                mop[methodKey] = (mop[methodKey] || 0) + amt;
            }
        });

        const receiptsCount = finalReceipts.length;
        const avgBasket = receiptsCount > 0 ? totalSales / receiptsCount : 0;
        
        return {
            stats: { totalSales, receiptsCount, avgBasket, discountsTotal },
            mopTotals: mop,
        };
    }, [statsReceipts]);


    const handleMopSelect = (mopName: string) => {
        setActiveMop(prev => prev === mopName ? null : mopName);
    }
    
    const handleCalendarChange = (range: {start: Date, end: Date}, preset: string | null) => {
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

    async function exportXlsx() {
        if (!activeStore) return;
    
        toast({ title: "Exporting...", description: "Fetching all billable items for the selected range. This may take a moment." });
    
        // 1. Build Receipts Sheet
        const receiptsRows = statsReceipts.map(r => {
            const a = r.analytics || {};
            const grandTotal = toNum(a.grandTotal);
            const discountsTotal = toNum(a.discountsTotal);
            const chargesTotal = toNum(a.chargesTotal);
            const totalPaid = toNum(a.totalPaid);
            const change = toNum(a.change);
            const netCollected = totalPaid - change;
    
            return {
                DateTime: formatLocal(r.createdAtClientMs),
                ReceiptNumber: r.receiptNumber ?? "",
                SessionMode: r.sessionMode ?? "",
                TableNumber: r.tableNumber ?? "",
                CustomerName: r.customerName ?? "",
                GrandTotal: grandTotal,
                Discounts: discountsTotal,
                Charges: chargesTotal,
                TotalPaid: totalPaid,
                Change: change,
                NetCollected: netCollected,
                PaymentMix: mopToString(a.mop),
                DiscountsBreakdown: a.discounts ? JSON.stringify(a.discounts) : "",
                ChargesBreakdown: a.charges ? JSON.stringify(a.charges) : "",
            };
        });
        const receiptsSheet = XLSX.utils.json_to_sheet(receiptsRows);
    
        // 2. Build Items Sheet
        const itemsRows: any[] = [];
        
        for (const receipt of statsReceipts) {
            const lines = receipt.lines || [];
            
            for (const item of lines) {
                const qty = toNum(item.qtyOrdered || 1);
                const unitPrice = toNum(item.unitPrice || 0);
                const lineSubtotal = qty * unitPrice;
    
                const lineDiscount = item.discountType === 'percent'
                    ? lineSubtotal * (toNum(item.discountValue) / 100)
                    : Math.min(toNum(item.discountValue) * qty, lineSubtotal);
                
                const lineTotal = lineSubtotal - lineDiscount;
    
                const a = receipt.analytics || {};
                const netCollected = toNum(a.totalPaid) - toNum(a.change);
    
                itemsRows.push({
                    ReceiptNumber: receipt.receiptNumber ?? "",
                    DateTime: formatLocal(receipt.createdAtClientMs),
                    SessionMode: receipt.sessionMode ?? "",
                    TableNumber: receipt.tableNumber ?? "",
                    CustomerName: receipt.customerName ?? "",
                    ItemName: item.itemName,
                    Category: (item as any).category ?? "",
                    Qty: qty,
                    UnitPrice: unitPrice,
                    LineSubtotal: lineSubtotal,
                    LineDiscount: lineDiscount,
                    LineTotal: lineTotal,
                    ReceiptDiscountsTotal: toNum(a.discountsTotal),
                    ReceiptChargesTotal: toNum(a.chargesTotal),
                    ReceiptNetCollected: netCollected,
                    DiscountsBreakdown: a.discounts ? JSON.stringify(a.discounts) : "",
                    ChargesBreakdown: a.charges ? JSON.stringify(a.charges) : "",
                });
            }
        }
        const itemsSheet = XLSX.utils.json_to_sheet(itemsRows);
    
        // 3. Create and Download Workbook
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, receiptsSheet, "Receipts");
        XLSX.utils.book_append_sheet(workbook, itemsSheet, "Items");
    
        const from = start.toISOString().slice(0, 10);
        const to = end.toISOString().slice(0, 10);
        const filename = `dashboard_${from}_to_${to}.xlsx`;
        XLSX.writeFile(workbook, filename);
    
        toast({ title: "Export Complete", description: "Your XLSX file has been downloaded." });
    }

    if (storeLoading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;
    }

    if (!activeStore) {
        return ( <Card className="w-full max-w-md mx-auto text-center"><CardHeader><CardTitle>No Store Selected</CardTitle><CardDescription>Please select a store to view its dashboard.</CardDescription></CardHeader></Card> );
    }
    
    const canViewDashboard = appUser?.role && ['admin', 'manager', 'cashier'].includes(appUser.role);

    return (
        <RoleGuard allow={["admin", "manager", "cashier", "server", "kitchen"]}>
            <div className="print:hidden">
                <PageHeader 
                    title="Dashboard" 
                    description={`Real-time overview of ${activeStore.name}'s performance.`}
                >
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
                            <Button variant="outline" size="sm" onClick={exportXlsx} disabled={statsReceipts.length === 0}><Download />Export XLSX</Button>
                        </div>
                        <p className="text-sm text-muted-foreground">{dateRangeLabel}</p>
                    </div>
                </PageHeader>

                {!canViewDashboard ? (
                    <Card className="mt-6"><CardContent className="p-10 text-center text-muted-foreground">Dashboard widgets for your role are coming soon.</CardContent></Card>
                ) : (
                    <div className="space-y-6 mt-6">
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                            <StatCard title="Total Sales" value={stats.totalSales} icon={<span className="text-muted-foreground font-bold">₱</span>} isLoading={isStatsLoading} format="currency" />
                            <StatCard title="Receipts" value={stats.receiptsCount} icon={<Receipt />} isLoading={isStatsLoading}>
                                <Button variant="outline" size="sm" className="mt-2" onClick={() => router.push('/receipts')}>View All</Button>
                            </StatCard>
                            <StatCard title="Avg Basket" value={stats.avgBasket} icon={<ShoppingBasket />} isLoading={isStatsLoading} format="currency" />
                            <StatCard title="Discounts Given" value={stats.discountsTotal} icon={<Percent />} isLoading={isStatsLoading} format="currency" />
                        </div>
                        
                        <div className="grid gap-6 md:grid-cols-2">
                             <Card>
                                <CardHeader>
                                    <div className="flex justify-between items-center">
                                      <CardTitle>Payment Mix</CardTitle>
                                      {activeMop && (<Badge variant="secondary" className="flex items-center gap-2">MOP: {activeMop}<button onClick={() => setActiveMop(null)} className="rounded-full hover:bg-muted-foreground/20 p-0.5"><XIcon className="h-3 w-3" /></button></Badge>)}
                                    </div>
                                </CardHeader>
                                <CardContent><PaymentMix tally={mopTotals} isLoading={isStatsLoading} activeMop={activeMop} onMopSelect={handleMopSelect} /></CardContent>
                            </Card>
                            <TopCategoryCard receipts={statsReceipts} isLoading={isStatsLoading} />
                        </div>
                         <div className="grid gap-6 md:grid-cols-2">
                            <PeakHoursCard storeId={activeStore.id} dateRange={{ start, end }} />
                            <AvgServingTimeCard storeId={activeStore.id} dateRange={{ start, end }} />
                        </div>
                        <div className="grid gap-6 md:grid-cols-2">
                            <AvgRefillsCard storeId={activeStore.id} dateRange={{ start, end }} />
                             
                        </div>
                    </div>
                )}
                 {error && <Card className="mt-6"><CardContent className="p-10 text-center text-destructive">{error}</CardContent></Card>}
            </div>
        </RoleGuard>
    );
}
