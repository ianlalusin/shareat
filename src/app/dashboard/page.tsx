

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
import type { ModeOfPayment, Receipt as ReceiptType, BillableLine } from "@/lib/types";
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

const RecentReceiptsList = ({ receipts, onSelect, isLoading, selectedId, onOlder, hasMore, loadingMore }: { receipts: RecentReceipt[], onSelect: (id: string) => void, isLoading: boolean, selectedId: string | null, onOlder: () => void, hasMore: boolean, loadingMore: boolean }) => {
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
             {hasMore && (
                <Button
                    variant="outline"
                    className="w-full mt-4"
                    onClick={onOlder}
                    disabled={loadingMore}
                >
                    {loadingMore ? <Loader2 className="animate-spin mr-2"/> : null}
                    {loadingMore ? "Loading..." : "Load older"}
                </Button>
            )}
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
    const { appUser } = useAuthContext();
    const { activeStore, loading: storeLoading } = useStoreContext();
    const [datePreset, setDatePreset] = useState<DatePreset>("today");
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);
    const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);
    
    // State for all receipts in the date range (for stats)
    const [rangeReceiptsAll, setRangeReceiptsAll] = useState<ReceiptType[]>([]);
    const [isStatsLoading, setIsStatsLoading] = useState(true);

    // Pagination states for the visible list
    const [liveReceipts, setLiveReceipts] = useState<ReceiptType[]>([]);
    const [olderReceipts, setOlderReceipts] = useState<ReceiptType[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
    const olderCountRef = useRef(0);
    useEffect(() => { olderCountRef.current = olderReceipts.length; }, [olderReceipts]);
    
    const [error, setError] = useState<string | null>(null);

    // Single source of truth for selection
    const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
    
    // Derived state for the detailed preview data
    const [detailedReceiptData, setDetailedReceiptData] = useState<ReceiptData | null>(null);
    
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);

    // Filter states
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "final" | "void">("all");
    const [modeFilter, setModeFilter] = useState<string>("all");
    const [activeMop, setActiveMop] = useState<string | null>(null);
    
    const [autoSelectLatest, setAutoSelectLatest] = useState(true);
    const autoSelectStorageKey = useMemo(() => `dashboard:autoSelectLatestReceipt:${activeStore?.id}:${appUser?.uid}`, [activeStore?.id, appUser?.uid]);

    useEffect(() => {
        const savedPref = localStorage.getItem(autoSelectStorageKey);
        if (savedPref !== null) {
            setAutoSelectLatest(savedPref === 'true');
        }
    }, [autoSelectStorageKey]);

    const handleAutoSelectToggle = (checked: boolean) => {
        setAutoSelectLatest(checked);
        localStorage.setItem(autoSelectStorageKey, String(checked));
    }


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

    // Live listener for the paginated receipt list
    useEffect(() => {
        if (!activeStore?.id) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setOlderReceipts([]);
        setLastDoc(null);
        setHasMore(true);

        const mapDocToReceipt = (doc: DocumentData): ReceiptType => ({ id: doc.id, ...doc.data() });

        const firstPageQuery = query(
            collection(db, "stores", activeStore.id, "receipts"),
            where("createdAt", ">=", start),
            where("createdAt", "<=", end),
            orderBy("createdAt", "desc"),
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


    const loadMore = async () => {
        if (!activeStore || !lastDoc || loadingMore || !hasMore) return;
        setLoadingMore(true);

        try {
            const mapDocToReceipt = (doc: DocumentData): ReceiptType => ({ id: doc.id, ...doc.data() });
            const moreQuery = query(
                collection(db, `stores/${activeStore.id}/receipts`),
                where("createdAt", ">=", start),
                where("createdAt", "<=", end),
                orderBy("createdAt", "desc"),
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
    
    // Combine live and paginated receipts for the list view
    const paginatedReceipts = useMemo(() => {
        const byId = new Map<string, ReceiptType>();
        for (const r of liveReceipts) byId.set(r.id, r);
        for (const r of olderReceipts) if (!byId.has(r.id)) byId.set(r.id, r);
        return Array.from(byId.values()).sort((a,b)=> (b.createdAtClientMs ?? 0) - (a.createdAtClientMs ?? 0));
    }, [liveReceipts, olderReceipts]);

    const modeOptions = useMemo(() => {
        const modes = new Set(paginatedReceipts.map(r => r.sessionMode).filter(Boolean));
        return ["all", ...Array.from(modes).sort()];
    }, [paginatedReceipts]);

    const applyFilters = useCallback((list: ReceiptType[]) => {
        const searchQuery = search.trim().toLowerCase();
        return list.filter(r => {
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
    }, [search, statusFilter, modeFilter, activeMop]);

    // Derived list for UI display
    const filteredReceipts = useMemo(() => applyFilters(paginatedReceipts), [paginatedReceipts, applyFilters]);
    
    // Derived list for stats calculation
    const statsReceipts = useMemo(() => applyFilters(rangeReceiptsAll), [rangeReceiptsAll, applyFilters]);
    
    // Auto-select logic
    useEffect(() => {
        const shouldAutoSelect = autoSelectLatest && (
            selectedReceiptId === null || 
            !filteredReceipts.some(r => r.id === selectedReceiptId)
        );

        if (shouldAutoSelect && filteredReceipts.length > 0) {
            setSelectedReceiptId(filteredReceipts[0].id);
        } else if (filteredReceipts.length === 0) {
            setSelectedReceiptId(null);
        }
    }, [filteredReceipts, autoSelectLatest, selectedReceiptId]);


    const { stats, mopTotals } = useMemo(() => {
        const finalReceipts = statsReceipts.filter(r => r.status === 'final' && r.analytics?.v === 2);

        let totalSales = 0;
        let discountsTotal = 0;
        const mop: Record<string, number> = {};

        finalReceipts.forEach(r => {
            if (r.analytics?.v !== 2) return; 
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

        const receiptsCount = finalReceipts.length;
        const avgBasket = receiptsCount > 0 ? totalSales / receiptsCount : 0;
        
        return {
            stats: { totalSales, receiptsCount, avgBasket, discountsTotal },
            mopTotals: mop,
        };
    }, [statsReceipts]);

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
    
   useEffect(() => {
        const fetchDetailedData = async () => {
            if (!selectedReceiptId || !activeStore?.id) {
                setDetailedReceiptData(null);
                return;
            }

            setIsLoadingPreview(true);
            try {
                // The receipt's ID is the session ID
                const sessionId = selectedReceiptId;

                const [receiptSnap, settingsSnap] = await Promise.all([
                    getDoc(doc(db, "stores", activeStore.id, "receipts", selectedReceiptId)),
                    getDoc(doc(db, "stores", activeStore.id, "receiptSettings", "main")),
                ]);

                if (!receiptSnap.exists()) {
                    throw new Error(`Receipt ${selectedReceiptId} does not exist.`);
                }
                
                const receiptDocData = receiptSnap.data({ serverTimestamps: "estimate" }) as any;
                
                // Construct a mock session object from the receipt data for the preview component
                const sessionDataForPreview = {
                    id: sessionId,
                    paymentSummary: receiptDocData.analytics,
                    closedAt: receiptDocData.createdAt,
                    // other fields if needed by ReceiptView that are on the receipt
                    tableNumber: receiptDocData.tableNumber,
                    customerName: receiptDocData.customerName,
                    sessionMode: receiptDocData.sessionMode,
                };
                
                setDetailedReceiptData({
                    session: sessionDataForPreview as any,
                    lines: receiptDocData.lines || [],
                    payments: Object.entries(receiptDocData.analytics?.mop || {}).map(([key, value]) => ({ methodId: key, amount: value as number })),
                    settings: settingsSnap.exists() ? (settingsSnap.data() as any) : {},
                    receiptCreatedAt: receiptDocData.createdAt,
                    createdByUsername: receiptDocData.createdByUsername,
                    receiptNumber: receiptDocData.receiptNumber,
                    analytics: receiptDocData.analytics,
                });

            } catch (err) {
                console.error("Error loading receipt preview:", err);
                setDetailedReceiptData(null);
            } finally {
                setIsLoadingPreview(false);
            }
        };

        fetchDetailedData();
    }, [selectedReceiptId, activeStore?.id]);


    const handlePrint = async () => {
      if (!detailedReceiptData || !activeStore?.id || !appUser || !selectedReceiptId) return;

      setIsPrinting(true);
      window.requestAnimationFrame(async () => {
        window.print();
        try {
          const receiptRef = doc(db, "stores", activeStore.id, "receipts", selectedReceiptId);
          await updateDoc(receiptRef, {
            printedCount: increment(1),
            lastPrintedAt: serverTimestamp(),
            lastPrintedByUid: appUser.uid,
            lastPrintedByUsername: getUsername(appUser),
          });
        } catch(e) {
            console.error("Failed to update print count:", e)
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
        const isExcludedStatus = (status?: string) => {
            if (!status) return false;
            const lowerStatus = status.toLowerCase();
            const excluded = ["cancelled", "canceled", "void", "voided", "removed", "deleted"];
            return excluded.includes(lowerStatus);
        }
    
        for (const receipt of statsReceipts) {
            const lines = receipt.lines || [];
            
            for (const item of lines) {
    
                if (item.freeQty > 0 || item.voidedQty > 0) {
                    continue;
                }
    
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
                    className="flex-col items-start gap-4 md:flex-row md:items-center"
                >
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 rounded-md bg-muted p-1 flex-wrap">
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
                        <Button variant="outline" size="sm" onClick={exportXlsx} disabled={statsReceipts.length === 0}><Download />Export XLSX</Button>
                    </div>
                </PageHeader>

                {!canViewDashboard ? (
                    <Card className="mt-6"><CardContent className="p-10 text-center text-muted-foreground">Dashboard widgets for your role are coming soon.</CardContent></Card>
                ) : (
                    <div className="space-y-6 mt-6">
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                            <StatCard title="Total Sales" value={stats.totalSales} icon={<span className="text-muted-foreground font-bold">₱</span>} isLoading={isStatsLoading} format="currency" />
                            <StatCard title="Receipts" value={stats.receiptsCount} icon={<Receipt />} isLoading={isStatsLoading} />
                            <StatCard title="Avg Basket" value={stats.avgBasket} icon={<ShoppingBasket />} isLoading={isStatsLoading} format="currency" />
                            <StatCard title="Discounts Given" value={stats.discountsTotal} icon={<Percent />} isLoading={isStatsLoading} format="currency" />
                        </div>
                        
                        <div className="grid gap-6 md:grid-cols-2">
                             <Card>
                                <CardHeader><CardTitle>Payment Mix</CardTitle></CardHeader>
                                <CardContent><PaymentMix tally={mopTotals} isLoading={isStatsLoading} activeMop={activeMop} onMopSelect={handleMopSelect} /></CardContent>
                            </Card>
                            <TopCategoryCard storeId={activeStore.id} dateRange={{ start, end }} />
                        </div>
                         <div className="grid gap-6 md:grid-cols-2">
                            <PeakHoursCard storeId={activeStore.id} dateRange={{ start, end }} />
                            <AvgServingTimeCard storeId={activeStore.id} dateRange={{ start, end }} />
                        </div>
                        <div className="grid gap-6 md:grid-cols-2">
                            <AvgRefillsCard storeId={activeStore.id} dateRange={{ start, end }} />
                             
                        </div>
                        
                         <Card>
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <CardTitle>Receipts</CardTitle>
                                    {activeMop && (<Badge variant="secondary" className="flex items-center gap-2">MOP: {activeMop}<button onClick={() => setActiveMop(null)} className="rounded-full hover:bg-muted-foreground/20 p-0.5"><XIcon className="h-3 w-3" /></button></Badge>)}
                                </div>
                                <CardDescription>Filter and browse receipts from the selected period.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid lg:grid-cols-5 gap-6">
                                <div className="lg:col-span-2 space-y-4">
                                     <div className="grid sm:grid-cols-[1fr,120px,120px] gap-2">
                                        <Input placeholder="Search receipt #, table, customer..." value={search} onChange={e => setSearch(e.target.value)} />
                                        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All Statuses</SelectItem><SelectItem value="final">Final</SelectItem><SelectItem value="void">Void</SelectItem></SelectContent></Select>
                                        <Select value={modeFilter} onValueChange={setModeFilter}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{modeOptions.map(mode => (<SelectItem key={mode} value={mode} className="capitalize">{mode === 'all' ? 'All Modes' : mode.replace('_', ' ')}</SelectItem>))}</SelectContent></Select>
                                     </div>
                                      <ScrollArea className="h-[420px] pr-4">
                                        <RecentReceiptsList receipts={recentReceipts} onSelect={setSelectedReceiptId} isLoading={isLoading} selectedId={selectedReceiptId} onOlder={loadMore} hasMore={hasMore} loadingMore={loadingMore} />
                                     </ScrollArea>
                                </div>
                                <div className="lg:col-span-3">
                                    <Card className="h-full">
                                        <CardHeader className="flex flex-row items-center justify-between">
                                            <CardTitle>Receipt Preview</CardTitle>
                                            {detailedReceiptData && (
                                                <Button onClick={handlePrint} disabled={isPrinting} size="sm">{isPrinting ? <Loader2 className="mr-2 animate-spin" /> : <Printer className="mr-2" />} Print</Button>
                                            )}
                                        </CardHeader>
                                        <CardContent className="bg-muted/30 p-2 min-h-[440px]">
                                            {isLoadingPreview ? (
                                                <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-muted-foreground" /></div>
                                            ) : detailedReceiptData ? (
                                                <ScrollArea className="h-[440px]">
                                                  <div id="print-receipt-area-dashboard"><ReceiptView data={detailedReceiptData} paymentMethods={paymentMethods} /></div>
                                                </ScrollArea>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4">
                                                    <h3 className="text-lg font-semibold text-foreground">Select a receipt</h3>
                                                    <p className="mb-4">Choose one from the list to preview and print.</p>
                                                    <div className="flex items-center space-x-2">
                                                        <Switch id="auto-select-toggle" checked={autoSelectLatest} onCheckedChange={handleAutoSelectToggle} />
                                                        <Label htmlFor="auto-select-toggle">Auto-select latest</Label>
                                                    </div>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
                 {error && <Card className="mt-6"><CardContent className="p-10 text-center text-destructive">{error}</CardContent></Card>}
            </div>
            <div className="hidden print-block">
                {detailedReceiptData && <ReceiptView data={detailedReceiptData} paymentMethods={paymentMethods} />}
            </div>
        </RoleGuard>
    );
}
