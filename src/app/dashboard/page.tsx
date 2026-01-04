
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
import type { ModeOfPayment } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { VoidedOrdersCard } from "@/components/dashboard/voided-orders-card";
import { TopCategoryCard } from "@/components/dashboard/top-category-card";


// --- HELPERS ---
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function isSameDay(a: Date, b: Date) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function fmtDate(d: Date) { return d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" }); }
function customBtnLabel(range: {start: Date; end: Date} | null, active: boolean) {
    if (!active || !range) return "Custom";
    return isSameDay(range.start, range.end)
        ? `Custom: ${fmtDate(range.start)}`
        : `Custom: ${fmtDate(range.start)} — ${fmtDate(range.end)}`;
}


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

type RecentReceipt = { id: string; receiptNumber?: string; customerName?: string | null; tableNumber?: string | null; sessionMode?: 'package_dinein' | 'alacarte'; total: number; createdAtClientMs: number; };

const RecentReceiptsList = ({ receipts, onSelect, isLoading, selectedId }: { receipts: RecentReceipt[], onSelect: (id: string) => void, isLoading: boolean, selectedId: string | null }) => {
    if (isLoading && receipts.length === 0) return <Skeleton className="h-48 w-full" />;
    if (receipts.length === 0) return <p className="text-center text-sm text-muted-foreground py-10">No receipts match the current filters.</p>;
    
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

type DatePreset = "today" | "yesterday" | "week" | "month" | "custom";
const presets: { label: string, value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
];
const PAGE_SIZE = 10;

function getUsername(appUser: any) {
    return (appUser?.displayName?.trim()) || (appUser?.name?.trim()) || (appUser?.email ? String(appUser.email).split("@")[0] : "") || (appUser?.uid ? String(appUser.uid).slice(0, 6) : "unknown");
}

const toNum = (v: any) => (typeof v === 'number' ? v : Number(v) || 0);

type ReceiptType = { id: string, createdAtClientMs: number, [key: string]: any };

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

function isLikelyId(k: string) {
  return /^[A-Za-z0-9]{16,}$/.test(k); // simple Firestore-id-ish check
}

function getReceiptMopLinesForDisplay(receipt: any, mopIdToName: Record<string,string>) {
  if (!mopIdToName) return [];
  const a = receipt?.analytics;

  // Prefer name-keyed analytics.mop
  if (a?.mop && typeof a.mop === "object") {
    const keys = Object.keys(a.mop);
    const hasHumanKey = keys.some(k => !isLikelyId(k));
    if (hasHumanKey) {
      return Object.entries(a.mop).map(([name, amt]) => ({
        name: String(name),
        amount: toNum(amt),
      })).filter(x => x.amount > 0);
    }
  }

  // Fallback: use id-keyed map (mopIds first, then receipt.mop, then a.mop even if id-keyed)
  const idMap =
    (a?.mopIds && typeof a.mopIds === "object" ? a.mopIds : null) ??
    (receipt?.mop && typeof receipt.mop === "object" ? receipt.mop : null) ??
    (a?.mop && typeof a.mop === "object" ? a.mop : null);

  if (!idMap) return [];

  return Object.entries(idMap).map(([id, amt]) => ({
    name: mopIdToName[id] ?? id,
    amount: toNum(amt),
  })).filter(x => x.amount > 0);
}

// Extend the base receipt data type for the dashboard's needs
type ReceiptData = BaseReceiptData & {
  analytics?: any;
};


export default function DashboardPage() {
    const { appUser } = useAuthContext();
    const { activeStore, loading: storeLoading } = useStoreContext();
    const [datePreset, setDatePreset] = useState<DatePreset>("today");
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);
    const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);
    
    // Pagination states
    const [liveReceipts, setLiveReceipts] = useState<ReceiptType[]>([]);
    const [olderReceipts, setOlderReceipts] = useState<ReceiptType[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
    const olderCountRef = useRef(0);
    useEffect(() => { olderCountRef.current = olderReceipts.length; }, [olderReceipts]);
    
    const [error, setError] = useState<string | null>(null);

    const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
    const [selectedReceiptData, setSelectedReceiptData] = useState<ReceiptData | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);

    // Filter states
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "final" | "void">("all");
    const [modeFilter, setModeFilter] = useState<string>("all");
    const [activeMop, setActiveMop] = useState<string | null>(null);

    // --- Data Fetching and Processing ---
    
    useEffect(() => {
        if (!activeStore?.id) return;
        const mopRef = collection(db, "stores", activeStore.id, "storeModesOfPayment");
        const mopQuery = query(
            mopRef, 
            where("isArchived", "==", false),
            orderBy("sortOrder", "asc")
        );
        const unsubscribe = onSnapshot(mopQuery, (snapshot) => {
            setPaymentMethods(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ModeOfPayment)));
        });
        return () => unsubscribe();
    }, [activeStore?.id]);

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

    const olderReceiptsRef = useRef(olderReceipts);
    useEffect(() => {
        olderReceiptsRef.current = olderReceipts;
    }, [olderReceipts]);


    // Live listener for the first page
    useEffect(() => {
        if (!activeStore?.id) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        // Reset pagination state when date range changes
        setOlderReceipts([]);
        setLastDoc(null);
        setHasMore(true);

        const mapDocToReceipt = (doc: DocumentData): ReceiptType => ({ id: doc.id, ...doc.data() });

        const firstPageQuery = query(
            collection(db, "stores", activeStore.id, "receipts"),
            where("createdAtClientMs", ">=", start.getTime()),
            where("createdAtClientMs", "<=", end.getTime()),
            orderBy("createdAtClientMs", "desc"),
            limit(PAGE_SIZE)
        );

        const unsubscribe = onSnapshot(firstPageQuery, (snapshot) => {
            const newLiveReceipts = snapshot.docs.map(mapDocToReceipt);
            setLiveReceipts(newLiveReceipts);

            if (olderCountRef.current === 0) {
                const newLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
                setLastDoc(newLastDoc);
            }
            
            setHasMore(snapshot.docs.length === PAGE_SIZE);

            setIsLoading(false);
            setError(null);
        }, (err) => {
            console.error("Dashboard onSnapshot error:", err);
            setError("Failed to load real-time dashboard data.");
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [activeStore?.id, start, end]);

    const loadMore = async () => {
        if (!activeStore || !lastDoc || loadingMore || !hasMore) return;
        setLoadingMore(true);

        try {
            const mapDocToReceipt = (doc: DocumentData): ReceiptType => ({ id: doc.id, ...doc.data() });
            const moreQuery = query(
                collection(db, `stores/${activeStore.id}/receipts`),
                where("createdAtClientMs", ">=", start.getTime()),
                where("createdAtClientMs", "<=", end.getTime()),
                orderBy("createdAtClientMs", "desc"),
                startAfter(lastDoc),
                limit(PAGE_SIZE)
            );

            const snap = await getDocs(moreQuery);
            const batch = snap.docs.map(mapDocToReceipt);
            
            setOlderReceipts(prev => {
                const seen = new Set(prev.map(x => x.id));
                const next = [...prev];
                for (const r of batch) if (!seen.has(r.id)) next.push(r);
                return next;
            });

            const newLast = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
            if (newLast) setLastDoc(newLast);
            setHasMore(snap.docs.length === PAGE_SIZE);
        } catch (err) {
            console.error("Error loading more receipts:", err);
            setError("Failed to load older receipts.");
        } finally {
            setLoadingMore(false);
        }
    };
    
    // Combine live and paginated receipts
    const receipts = useMemo(() => {
        const byId = new Map<string, ReceiptType>();
        for (const r of liveReceipts) byId.set(r.id, r);
        for (const r of olderReceipts) if (!byId.has(r.id)) byId.set(r.id, r);
        return Array.from(byId.values()).sort((a,b)=> (b.createdAtClientMs ?? 0) - (a.createdAtClientMs ?? 0));
    }, [liveReceipts, olderReceipts]);

    const modeOptions = useMemo(() => {
        const modes = new Set(receipts.map(r => r.sessionMode).filter(Boolean));
        return ["all", ...Array.from(modes).sort()];
    }, [receipts]);

    const filteredReceipts = useMemo(() => {
        const searchQuery = search.trim().toLowerCase();
        return receipts.filter(r => {
            if (statusFilter !== 'all' && r.status !== statusFilter) return false;
            if (modeFilter !== 'all' && r.sessionMode !== modeFilter) return false;
            
            if (activeMop) {
                const mopData = r.analytics?.mop;
                if (!mopData || typeof mopData !== 'object' || !(activeMop in mopData) || !((mopData as any)[activeMop] > 0)) {
                    return false;
                }
            }

            if (searchQuery) {
                const receiptNumMatch = r.receiptNumber?.toLowerCase().includes(searchQuery);
                const tableNumMatch = r.tableNumber?.toLowerCase().includes(searchQuery);
                const customerNameMatch = typeof r.customerName === 'string' && r.customerName.toLowerCase().includes(searchQuery);
                if (!receiptNumMatch && !tableNumMatch && !customerNameMatch) return false;
            }
            return true;
        });
    }, [receipts, search, statusFilter, modeFilter, activeMop]);

    useEffect(() => {
        if (selectedReceiptId && !filteredReceipts.some(r => r.id === selectedReceiptId)) {
            setSelectedReceiptId(null);
            setSelectedReceiptData(null);
        }
    }, [filteredReceipts, selectedReceiptId]);


    const { stats, mopTotals } = useMemo(() => {
        let totalSales = 0;
        let discountsTotal = 0;
        const mop: Record<string, number> = {};

        filteredReceipts.forEach(r => {
            totalSales += toNum(r.analytics?.grandTotal);
            discountsTotal += toNum(r.analytics?.discountsTotal);

            const tenderedMop = r.analytics?.mop;
            if (tenderedMop && typeof tenderedMop === 'object') {
                const netMop = { ...tenderedMop };
                const change = toNum(r.analytics?.change);

                if (change > 0) {
                    const cashKey = Object.keys(netMop).find(k => k.toLowerCase().includes('cash'));

                    if (cashKey && toNum(netMop[cashKey]) > 0) {
                        netMop[cashKey] = Math.max(0, toNum(netMop[cashKey]) - change);
                    } else {
                        // Fallback: deduct from largest payment method if no cash
                        let maxKey = '';
                        let maxAmount = 0;
                        for (const [key, value] of Object.entries(netMop)) {
                           const amount = toNum(value);
                           if (amount > maxAmount) {
                               maxAmount = amount;
                               maxKey = key;
                           }
                        }
                        if (maxKey) {
                            netMop[maxKey] = Math.max(0, toNum(netMop[maxKey]) - change);
                        }
                    }
                }
                
                for (const [methodKey, amount] of Object.entries(netMop)) {
                     const amt = toNum(amount);
                     mop[methodKey] = (mop[methodKey] || 0) + amt;
                }
            }
        });

        const receiptsCount = filteredReceipts.length;
        const avgBasket = receiptsCount > 0 ? totalSales / receiptsCount : 0;
        
        return {
            stats: { totalSales, receiptsCount, avgBasket, discountsTotal },
            mopTotals: mop,
        };
    }, [filteredReceipts]);

    const recentReceipts = useMemo(() => {
       return filteredReceipts.map(r => ({
            id: r.id,
            receiptNumber: r.receiptNumber,
            total: toNum(r.analytics?.grandTotal ?? r.total),
            customerName: r.customerName,
            tableNumber: r.tableNumber,
            sessionMode: r.sessionMode,
            createdAtClientMs: r.createdAtClientMs
        }))
    }, [filteredReceipts]);


    const handleMopSelect = (mopName: string) => {
        setActiveMop(prev => prev === mopName ? null : mopName);
    }

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
                analytics: receiptDocData.analytics,
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

    function exportCsv() {
        const rows = filteredReceipts.map(r => {
            const a = r.analytics || {};
            const grandTotal = toNum(a.grandTotal);
            const discountsTotal = toNum(a.discountsTotal);
            const chargesTotal = toNum(a.chargesTotal);
            const totalPaid = toNum(a.totalPaid);
            const change = toNum(a.change);
            const netCollected = totalPaid - change;

            return [
                formatLocal(r.createdAtClientMs),
                r.receiptNumber ?? "",
                r.sessionMode ?? "",
                r.tableNumber ?? "",
                r.customerName ?? "",
                grandTotal,
                discountsTotal,
                chargesTotal,
                totalPaid,
                change,
                netCollected,
                mopToString(a.mop),
            ];
        });

        const header = [
            "DateTime",
            "ReceiptNumber",
            "SessionMode",
            "TableNumber",
            "CustomerName",
            "GrandTotal",
            "DiscountsTotal",
            "ChargesTotal",
            "TotalPaid",
            "Change",
            "NetCollected",
            "PaymentMix",
        ];

        const csv = [
            header.map(csvEscape).join(","),
            ...rows.map(row => row.map(csvEscape).join(",")),
        ].join("\n");

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);

        const from = start.toISOString().slice(0,10);
        const to = end.toISOString().slice(0,10);
        const filename = `dashboard_${from}_to_${to}.csv`;

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }


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
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 rounded-md bg-muted p-1">
                            {presets.map(p => (
                                <Button key={p.value} variant={datePreset === p.value ? 'default' : 'ghost'} size="sm" onClick={() => { setDatePreset(p.value); setCustomRange(null); }} className="h-8">{p.label}</Button>
                            ))}
                            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={datePreset === "custom" ? "default" : "ghost"}
                                        size="sm"
                                        className="h-8 min-w-[100px]"
                                    >
                                        {customBtnLabel(customRange, datePreset === "custom")}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <CompactCalendar onChange={handleCalendarChange}/>
                                </PopoverContent>
                            </Popover>
                        </div>
                        <Button variant="outline" size="sm" onClick={exportCsv} disabled={filteredReceipts.length === 0}>
                            <Download />
                            Export CSV
                        </Button>
                    </div>
                </PageHeader>

                {!canViewDashboard ? (
                    <Card className="mt-6"><CardContent className="p-10 text-center text-muted-foreground">Dashboard widgets for your role are coming soon.</CardContent></Card>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                        <div className="lg:col-span-2 space-y-6">
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                                <StatCard title="Total Sales" value={stats.totalSales} icon={<span className="text-muted-foreground font-bold">₱</span>} isLoading={isLoading} format="currency" />
                                <StatCard title="Receipts" value={stats.receiptsCount} icon={<Receipt />} isLoading={isLoading} />
                                <StatCard title="Avg Basket" value={stats.avgBasket} icon={<ShoppingBasket />} isLoading={isLoading} format="currency" />
                                <StatCard title="Discounts Given" value={stats.discountsTotal} icon={<Percent />} isLoading={isLoading} format="currency" />
                            </div>
                            <div className="grid gap-6 md:grid-cols-2">
                                <Card>
                                    <CardHeader><CardTitle>Payment Mix</CardTitle></CardHeader>
                                    <CardContent><PaymentMix tally={mopTotals} isLoading={isLoading} activeMop={activeMop} onMopSelect={handleMopSelect} /></CardContent>
                                </Card>
                                <TopCategoryCard storeId={activeStore.id} dateRange={{ start, end }} />
                            </div>
                            <VoidedOrdersCard storeId={activeStore.id} dateRange={{ start, end }} />
                            <Card>
                                <CardHeader>
                                    <div className="flex justify-between items-center">
                                        <CardTitle>Receipts</CardTitle>
                                        {activeMop && (
                                            <Badge variant="secondary" className="flex items-center gap-2">
                                                MOP: {activeMop}
                                                <button onClick={() => setActiveMop(null)} className="rounded-full hover:bg-muted-foreground/20 p-0.5">
                                                    <XIcon className="h-3 w-3" />
                                                </button>
                                            </Badge>
                                        )}
                                    </div>
                                    <CardDescription>Filter and browse receipts from the selected period.</CardDescription>
                                     <div className="grid sm:grid-cols-[1fr,120px,120px] gap-2 pt-2">
                                        <Input 
                                            placeholder="Search receipt #, table, customer..."
                                            value={search}
                                            onChange={e => setSearch(e.target.value)}
                                        />
                                        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}>
                                            <SelectTrigger><SelectValue/></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">All Statuses</SelectItem>
                                                <SelectItem value="final">Final</SelectItem>
                                                <SelectItem value="void">Void</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select value={modeFilter} onValueChange={setModeFilter}>
                                            <SelectTrigger><SelectValue/></SelectTrigger>
                                            <SelectContent>
                                                {modeOptions.map(mode => (
                                                     <SelectItem key={mode} value={mode} className="capitalize">{mode === 'all' ? 'All Modes' : mode.replace('_', ' ')}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                     </div>
                                </CardHeader>
                                <CardContent>
                                    <RecentReceiptsList receipts={recentReceipts} onSelect={handleSelectReceipt} isLoading={isLoading} selectedId={selectedReceiptId} />
                                    {hasMore && (
                                        <Button
                                            variant="outline"
                                            className="w-full mt-4"
                                            onClick={loadMore}
                                            disabled={loadingMore || !lastDoc}
                                        >
                                            {loadingMore ? <Loader2 className="animate-spin mr-2"/> : null}
                                            {loadingMore ? "Loading..." : "Load older"}
                                        </Button>
                                    )}
                                    {olderReceipts.length > 0 && <p className="text-xs text-center text-muted-foreground mt-2">Showing {receipts.length} loaded receipts.</p>}
                                </CardContent>
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
                                        <div id="print-receipt-area-dashboard"><ReceiptView data={selectedReceiptData} paymentMethods={paymentMethods} /></div>
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
                {selectedReceiptData && <ReceiptView data={selectedReceiptData} paymentMethods={paymentMethods} />}
            </div>
        </RoleGuard>
    );
}
