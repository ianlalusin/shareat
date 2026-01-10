

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
import { useAuthContext } from "@/context/auth-context";
import { ReceiptView, type ReceiptData as BaseReceiptData } from "@/components/receipt/receipt-view";
import type { ModeOfPayment, Receipt as ReceiptType, Store } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";


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

const RecentReceiptsList = ({ receipts, onSelect, isLoading, selectedId, onOlder, hasMore, loadingMore }: { receipts: ReceiptType[], onSelect: (id: string) => void, isLoading: boolean, selectedId: string | null, onOlder: () => void, hasMore: boolean, loadingMore: boolean }) => {
    if (isLoading && receipts.length === 0) return <div className="flex items-center justify-center h-48"><Loader2 className="animate-spin" /></div>;
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
                        <div className="font-medium">₱{(r.analytics?.grandTotal ?? r.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
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

// --- Main Page Component ---
type DatePreset = "today" | "yesterday" | "week" | "month" | "custom";
const presets: { label: string, value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
];
const PAGE_SIZE = 25;

function getUsername(appUser: any) {
    return (appUser?.displayName?.trim()) || (appUser?.name?.trim()) || (appUser?.email ? String(appUser.email).split("@")[0] : "") || (appUser?.uid ? String(appUser.uid).slice(0, 6) : "unknown");
}

type ReceiptData = BaseReceiptData & {
  analytics?: any;
};

const toNum = (v: any) => (typeof v === 'number' ? v : Number(v) || 0);


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


export default function ReceiptsBrowserPage() {
    const { appUser } = useAuthContext();
    const { activeStore, loading: storeLoading } = useStoreContext();
    const { toast } = useToast();
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
    const [detailedReceiptData, setDetailedReceiptData] = useState<ReceiptData | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);

    // Filter states
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "final" | "void">("all");
    const [modeFilter, setModeFilter] = useState<string>("all");
    const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm" | "A4">("80mm");
    
    const [autoSelectLatest, setAutoSelectLatest] = useState(true);
    const autoSelectStorageKey = useMemo(() => `receiptsPage:autoSelectLatest:${activeStore?.id}:${appUser?.uid}`, [activeStore?.id, appUser?.uid]);

     useEffect(() => {
        const savedPref = localStorage.getItem(autoSelectStorageKey);
        if (savedPref !== null) setAutoSelectLatest(savedPref === 'true');
    }, [autoSelectStorageKey]);

    const handleAutoSelectToggle = (checked: boolean) => {
        setAutoSelectLatest(checked);
        localStorage.setItem(autoSelectStorageKey, String(checked));
    }

    // --- Data Fetching ---
    
    useEffect(() => {
        if (!activeStore?.id) return;
        const mopRef = collection(db, "stores", activeStore.id, "storeModesOfPayment");
        const mopQuery = query(mopRef, where("isArchived", "==", false), orderBy("sortOrder", "asc"));
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
            case "today": s.setHours(0, 0, 0, 0); e.setHours(23, 59, 59, 999); break;
            case "yesterday": s.setDate(now.getDate() - 1); s.setHours(0, 0, 0, 0); e.setDate(now.getDate() - 1); e.setHours(23, 59, 59, 999); break;
            case "week": s.setDate(now.getDate() - now.getDay()); s.setHours(0, 0, 0, 0); break;
            case "month": s = new Date(now.getFullYear(), now.getMonth(), 1); break;
            case "custom": if (customRange) { s = startOfDay(customRange.start); e = endOfDay(customRange.end); } else { s.setHours(0, 0, 0, 0); e.setHours(23, 59, 59, 999); } break;
        }
        return { start: s, end: e };
    }, [datePreset, customRange]);

    const dateRangeLabel = useMemo(() => {
        if (isSameDay(start, end)) return fmtDate(start);
        return `${fmtDate(start)} - ${fmtDate(end)}`;
    }, [start, end]);

    useEffect(() => {
        if (!activeStore?.id) { setIsLoading(false); return; }
        setIsLoading(true); setOlderReceipts([]); setLastDoc(null); setHasMore(true);

        const mapDocToReceipt = (doc: DocumentData): ReceiptType => ({ id: doc.id, ...doc.data() });
        const firstPageQuery = query(
            collection(db, "stores", activeStore.id, "receipts"),
            where("createdAt", ">=", start), where("createdAt", "<=", end),
            orderBy("createdAt", "desc"), limit(PAGE_SIZE)
        );

        const unsubscribe = onSnapshot(firstPageQuery, (snapshot) => {
            const newLiveReceipts = snapshot.docs.map(mapDocToReceipt);
            setLiveReceipts(newLiveReceipts);
            if (olderCountRef.current === 0) setLastDoc(snapshot.docs[snapshot.docs.length - 1] ?? null);
            setHasMore(snapshot.docs.length === PAGE_SIZE);
            setIsLoading(false); setError(null);
        }, (err) => {
            console.error("Receipts page onSnapshot error:", err);
            setError("Failed to load real-time receipt data.");
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
                where("createdAt", ">=", start), where("createdAt", "<=", end),
                orderBy("createdAt", "desc"), startAfter(lastDoc), limit(PAGE_SIZE)
            );
            const snap = await getDocs(moreQuery);
            const batch = snap.docs.map(mapDocToReceipt);
            setOlderReceipts(prev => [...prev, ...batch]);
            setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
            setHasMore(snap.docs.length === PAGE_SIZE);
        } catch (err) {
            console.error("Error loading more receipts:", err); setError("Failed to load older receipts.");
        } finally { setLoadingMore(false); }
    };

    const paginatedReceipts = useMemo(() => {
        const byId = new Map<string, ReceiptType>();
        liveReceipts.forEach(r => byId.set(r.id, r));
        olderReceipts.forEach(r => byId.set(r.id, r));
        return Array.from(byId.values()).sort((a,b)=> (b.createdAtClientMs ?? 0) - (a.createdAtClientMs ?? 0));
    }, [liveReceipts, olderReceipts]);

    const modeOptions = useMemo(() => {
        const modes = new Set(paginatedReceipts.map(r => r.sessionMode).filter(Boolean));
        return ["all", ...Array.from(modes).sort()];
    }, [paginatedReceipts]);

    const filteredReceipts = useMemo(() => {
        const searchQuery = search.trim().toLowerCase();
        return paginatedReceipts.filter(r => {
            if (statusFilter !== 'all' && r.status !== statusFilter) return false;
            if (modeFilter !== 'all' && r.sessionMode !== modeFilter) return false;
            if (searchQuery) {
                const receiptNumMatch = r.receiptNumber?.toLowerCase().includes(searchQuery);
                const tableNumMatch = r.tableNumber?.toLowerCase().includes(searchQuery);
                const customerNameMatch = typeof r.customerName === 'string' && r.customerName.toLowerCase().includes(searchQuery);
                if (!receiptNumMatch && !tableNumMatch && !customerNameMatch) return false;
            }
            return true;
        });
    }, [paginatedReceipts, search, statusFilter, modeFilter]);
    
    useEffect(() => {
        if (autoSelectLatest && selectedReceiptId === null && filteredReceipts.length > 0) {
            setSelectedReceiptId(filteredReceipts[0].id);
        } else if (filteredReceipts.length === 0) {
            setSelectedReceiptId(null);
        }
    }, [filteredReceipts, autoSelectLatest, selectedReceiptId]);

   useEffect(() => {
        const fetchDetailedData = async () => {
            if (!selectedReceiptId || !activeStore?.id) { setDetailedReceiptData(null); return; }
            setIsLoadingPreview(true);
            try {
                const [receiptSnap, settingsSnap] = await Promise.all([
                    getDoc(doc(db, "stores", activeStore.id, "receipts", selectedReceiptId)),
                    getDoc(doc(db, "stores", activeStore.id, "receiptSettings", "main")),
                ]);
                if (!receiptSnap.exists()) throw new Error(`Receipt ${selectedReceiptId} does not exist.`);
                
                const receiptDocData = receiptSnap.data({ serverTimestamps: "estimate" }) as any;
                const sessionDataForPreview = {
                    id: receiptDocData.sessionId, paymentSummary: receiptDocData.analytics, closedAt: receiptDocData.createdAt,
                    tableNumber: receiptDocData.tableNumber, customerName: receiptDocData.customerName, sessionMode: receiptDocData.sessionMode,
                };
                setDetailedReceiptData({
                    session: sessionDataForPreview as any, lines: receiptDocData.lines || [],
                    payments: Object.entries(receiptDocData.analytics?.mop || {}).map(([key, value]) => ({ methodId: key, amount: value as number })),
                    settings: settingsSnap.exists() ? (settingsSnap.data() as any) : {}, receiptCreatedAt: receiptDocData.createdAt,
                    createdByUsername: receiptDocData.createdByUsername, receiptNumber: receiptDocData.receiptNumber, analytics: receiptDocData.analytics, store: activeStore
                });
            } catch (err) {
                console.error("Error loading receipt preview:", err); setDetailedReceiptData(null);
            } finally { setIsLoadingPreview(false); }
        };
        fetchDetailedData();
    }, [selectedReceiptId, activeStore]);


    const handlePrint = async () => {
      if (!detailedReceiptData || !activeStore?.id || !appUser || !selectedReceiptId) return;
      setIsPrinting(true);
      window.requestAnimationFrame(async () => {
        window.print();
        try {
          const receiptRef = doc(db, "stores", activeStore.id, "receipts", selectedReceiptId);
          await updateDoc(receiptRef, { printedCount: increment(1), lastPrintedAt: serverTimestamp(), lastPrintedByUid: appUser.uid, lastPrintedByUsername: getUsername(appUser) });
        } catch(e) { console.error("Failed to update print count:", e) }
        finally { setIsPrinting(false); }
      });
    };

    const handleCalendarChange = (range: {start: Date, end: Date}, preset: string | null) => {
        const presetMap: Record<string, DatePreset> = { today: "today", yesterday: "yesterday", lastWeek: "week", lastMonth: "month" };
        if (preset && preset !== "custom" && presetMap[preset]) { setDatePreset(presetMap[preset]); setCustomRange(null); }
        else { setCustomRange({ start: range.start, end: range.end }); setDatePreset("custom"); }
        setIsCalendarOpen(false);
    };

    async function exportXlsx() {
        if (!activeStore) return;
    
        toast({ title: "Exporting...", description: "Fetching all billable items for the selected range. This may take a moment." });
    
        // 1. Build Receipts Sheet
        const receiptsRows = filteredReceipts.map(r => {
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
        
        for (const receipt of filteredReceipts) {
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
        const filename = `receipts_${from}_to_${to}.xlsx`;
        XLSX.writeFile(workbook, filename);
    
        toast({ title: "Export Complete", description: "Your XLSX file has been downloaded." });
    }

    if (storeLoading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;
    }

    if (!activeStore) {
        return ( <Card className="w-full max-w-md mx-auto text-center"><CardHeader><CardTitle>No Store Selected</CardTitle><CardDescription>Please select a store to view its receipts.</CardDescription></CardHeader></Card> );
    }

    return (
        <RoleGuard allow={["admin", "manager", "cashier"]}>
            <div className="print:hidden h-full flex flex-col">
                <PageHeader title="Receipts" description={`Browse, filter, and print transactions for ${activeStore.name}`}>
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
                             <Button variant="outline" size="sm" onClick={exportXlsx} disabled={filteredReceipts.length === 0}><Download />Export XLSX</Button>
                        </div>
                        <p className="text-sm text-muted-foreground">{dateRangeLabel}</p>
                    </div>
                </PageHeader>
                
                <Card className="mt-6 flex-1">
                    <CardContent className="grid lg:grid-cols-5 gap-6 h-full p-4">
                        <div className="lg:col-span-2 flex flex-col gap-4">
                                <div className="grid sm:grid-cols-[1fr,120px,120px] gap-2">
                                <Input placeholder="Search receipt #, table, customer..." value={search} onChange={e => setSearch(e.target.value)} />
                                <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All Statuses</SelectItem><SelectItem value="final">Final</SelectItem><SelectItem value="void">Void</SelectItem></SelectContent></Select>
                                <Select value={modeFilter} onValueChange={setModeFilter}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{modeOptions.map(mode => (<SelectItem key={mode} value={mode} className="capitalize">{mode === 'all' ? 'All Modes' : mode.replace('_', ' ')}</SelectItem>))}</SelectContent></Select>
                                </div>
                                <ScrollArea className="flex-1 pr-4">
                                <RecentReceiptsList receipts={filteredReceipts} onSelect={setSelectedReceiptId} isLoading={isLoading} selectedId={selectedReceiptId} onOlder={loadMore} hasMore={hasMore} loadingMore={loadingMore} />
                                </ScrollArea>
                        </div>
                        <div className="lg:col-span-3">
                            <Card className="h-full flex flex-col">
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle>Receipt Preview</CardTitle>
                                    <div className="flex items-center gap-2">
                                        <Select value={paperWidth} onValueChange={(v) => setPaperWidth(v as any)}>
                                            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                                            <SelectContent><SelectItem value="58mm">58mm</SelectItem><SelectItem value="80mm">80mm</SelectItem><SelectItem value="A4">A4</SelectItem></SelectContent>
                                        </Select>
                                        {detailedReceiptData && (
                                            <Button onClick={handlePrint} disabled={isPrinting} size="sm">{isPrinting ? <Loader2 className="mr-2 animate-spin" /> : <Printer className="mr-2" />} Print</Button>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="bg-muted/30 p-2 flex-1">
                                    {isLoadingPreview ? (
                                        <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-muted-foreground" /></div>
                                    ) : detailedReceiptData ? (
                                        <ScrollArea className="h-full">
                                            <div id="print-receipt-area"><ReceiptView data={detailedReceiptData} paymentMethods={paymentMethods} forcePaperWidth={paperWidth} /></div>
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
            <div className="hidden print-block">
                {detailedReceiptData && <ReceiptView data={detailedReceiptData} paymentMethods={paymentMethods} forcePaperWidth={paperWidth} />}
            </div>
        </RoleGuard>
    );
}


