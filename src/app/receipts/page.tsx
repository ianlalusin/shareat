
"use client";

import * as React from "react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Printer, Search, Settings, Download, Calendar as CalendarIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useStoreContext } from "@/context/store-context";
import { db } from "@/lib/firebase/client";
import { collection, query, orderBy, onSnapshot, doc, getDoc, updateDoc, increment, serverTimestamp, where, Timestamp } from "firebase/firestore";
import { format } from "date-fns";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { ReceiptView, type ReceiptData } from "@/components/receipt/receipt-view";
import { ReceiptSettings as ReceiptTemplateSettings, receiptSettingsSchema } from "@/components/receipts/ReceiptTemplateSettings";
import { useAuthContext } from "@/context/auth-context";
import { toJsDate } from "@/lib/utils/date";
import type { Receipt as ReceiptType, ModeOfPayment, Store } from "@/lib/types";
import * as XLSX from "xlsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";

// --- Date Helpers ---
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

type DatePreset = "today" | "yesterday" | "week" | "month" | "custom";
const presets: { label: string, value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
];


function getUsername(appUser: any) {
  return (appUser?.displayName?.trim())
    || (appUser?.name?.trim())
    || (appUser?.email ? String(appUser.email).split("@")[0] : "")
    || (appUser?.uid ? String(appUser.uid).slice(0,6) : "unknown");
}

function ReceiptsPageContents() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const { appUser } = useAuthContext();
    const { activeStore, loading: storeLoading } = useStoreContext();

    const [receipts, setReceipts] = useState<ReceiptType[]>([]);
    const [isLoadingReceipts, setIsLoadingReceipts] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
    const [selectedReceiptData, setSelectedReceiptData] = useState<ReceiptData | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);

    // --- Date State ---
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

    const form = useForm({
        resolver: zodResolver(receiptSettingsSchema),
        defaultValues: {
            businessName: activeStore?.name || "",
            branchName: activeStore?.name || "",
            address: activeStore?.address || "",
            contact: activeStore?.contactNumber || "",
            tin: activeStore?.tin || "",
            logoUrl: activeStore?.logoUrl || null,
            vatType: activeStore?.vatType as any || "NON_VAT",
            footerText: "",
            showCashierName: true,
            showTableOrCustomer: true,
            showItemNotes: true,
            showDiscountBreakdown: true,
            showChargeBreakdown: true,
            paperWidth: "80mm",
            receiptNoFormat: "SELIP-######",
            autoPrintAfterPayment: false,
        }
    });

    useEffect(() => {
        if (!searchParams) return;
      
        const rid = searchParams.get("rid");
        if (rid) setSelectedReceiptId(rid);
      }, [searchParams]);
      

    useEffect(() => {
        if (!activeStore) {
            setIsLoadingReceipts(false);
            setReceipts([]);
            return;
        }

        setIsLoadingReceipts(true);
        const q = query(
            collection(db, "stores", activeStore.id, "receipts"), 
            where("createdAt", ">=", start),
            where("createdAt", "<=", end),
            orderBy("createdAt", "desc")
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setReceipts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ReceiptType)));
            setIsLoadingReceipts(false);
        }, (error) => {
            console.error("Error fetching receipts:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch receipts.' });
            setIsLoadingReceipts(false);
        });

        return () => unsubscribe();
    }, [activeStore, start, end, toast]);

    const filteredReceipts = useMemo(() => {
        if (!debouncedSearchTerm) return receipts;
        const lowercasedFilter = debouncedSearchTerm.toLowerCase();
        return receipts.filter(r => 
            r.receiptNumber?.toLowerCase().includes(lowercasedFilter) ||
            r.customerName?.toLowerCase().includes(lowercasedFilter) ||
            r.tableNumber?.toLowerCase().includes(lowercasedFilter) ||
            r.createdByUsername?.toLowerCase().includes(lowercasedFilter)
        );
    }, [receipts, debouncedSearchTerm]);

    const handleSelectReceipt = useCallback((receiptId: string) => {
        setSelectedReceiptId(receiptId);
        const newUrl = `${window.location.pathname}?rid=${receiptId}`;
        window.history.replaceState({ ...window.history.state, as: newUrl, url: newUrl }, '', newUrl);
    }, []);

    useEffect(() => {
        if (!selectedReceiptId || !activeStore) {
            setSelectedReceiptData(null);
            return;
        }
        setIsLoadingPreview(true);
        const fetchReceiptDetails = async () => {
             try {
                const [settingsSnap, receiptSnap] = await Promise.all([
                    getDoc(doc(db, "stores", activeStore.id, "receiptSettings", "main")),
                    getDoc(doc(db, "stores", activeStore.id, "receipts", selectedReceiptId))
                ]);
                
                if (!receiptSnap.exists()) throw new Error("Receipt not found.");

                const receiptDocData = receiptSnap.data({ serverTimestamps: "estimate" }) as any;
                const settingsData = settingsSnap.exists() ? settingsSnap.data() as any : {};
                
                const sessionDataForPreview = {
                    id: receiptDocData.sessionId,
                    tableNumber: receiptDocData.tableNumber,
                    customerName: receiptDocData.customerName,
                    sessionMode: receiptDocData.sessionMode,
                    paymentSummary: receiptDocData.analytics,
                    closedAt: receiptDocData.createdAt,
                    startedByUid: "N/A",
                };
                
                setSelectedReceiptData({
                    session: sessionDataForPreview as any,
                    lines: receiptDocData.lines || [],
                    payments: Object.entries(receiptDocData.analytics?.mop || {}).map(([key, value]) => ({ methodId: key, amount: value as number})),
                    settings: settingsData,
                    store: activeStore as Store,
                    receiptCreatedAt: receiptDocData.createdAt,
                    createdByUsername: receiptDocData.createdByUsername,
                    receiptNumber: receiptDocData.receiptNumber,
                    analytics: receiptDocData.analytics,
                });
                
            } catch (err: any) {
                toast({ variant: 'destructive', title: 'Error loading preview', description: err.message });
                setSelectedReceiptData(null);
            } finally {
                setIsLoadingPreview(false);
            }
        };
        fetchReceiptDetails();
    }, [selectedReceiptId, activeStore, toast]);
    
    useEffect(() => {
      if (isSettingsOpen && activeStore) {
        const settingsRef = doc(db, "stores", activeStore.id, "receiptSettings", "main");
        const unsub = onSnapshot(settingsRef, (doc) => {
          if (doc.exists()) {
            form.reset({
              ...form.getValues(), // keep potentially unsaved data
              ...doc.data(),
            });
          }
        });
        return () => unsub();
      }
    }, [isSettingsOpen, activeStore, form]);

    const handlePrint = async () => {
        if (!selectedReceiptData || !selectedReceiptId || !appUser || !activeStore) return;
        setIsPrinting(true);
        window.print();
        try {
            const receiptRef = doc(db, `stores/${activeStore.id}/receipts`, selectedReceiptId);
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
    }

    const handleExport = () => {
        // Sheet 1: Receipts Summary
        const summaryData = filteredReceipts.map(r => {
            const analytics = r.analytics || {};
            const paymentMethods = analytics.mop ? Object.keys(analytics.mop).join(', ') : 'N/A';
            return {
                "Receipt Number": r.receiptNumber || 'N/A',
                "Date": r.createdAt ? format(toJsDate(r.createdAt)!, 'MM/dd/yy p') : 'N/A',
                "Cashier": r.createdByUsername || 'N/A',
                "Subtotal": analytics.subtotal || 0,
                "Discounts": analytics.discountsTotal || 0,
                "Charges": analytics.chargesTotal || 0,
                "Grand Total": analytics.grandTotal || r.total,
                "Total Paid": analytics.totalPaid || 0,
                "Payment Methods": paymentMethods,
            };
        });

        // Sheet 2: Itemized Sales
        const itemizedData: any[] = [];
        filteredReceipts.forEach(r => {
            if (r.lines && Array.isArray(r.lines)) {
                r.lines.forEach(line => {
                    const billableQty = (line.qtyOrdered || 0) - (line.voidedQty || 0);
                    if (billableQty <= 0) return;

                    const lineTotal = billableQty * (line.unitPrice || 0);
                    let discountAmount = 0;
                    if ((line.discountValue ?? 0) > 0 && (line.discountQty ?? 0) > 0) {
                         const discountedQty = Math.min(line.discountQty, billableQty);
                        if (line.discountType === 'percent') {
                            discountAmount = (discountedQty * (line.unitPrice || 0)) * (line.discountValue! / 100);
                        } else {
                            discountAmount = (line.discountValue ?? 0) * discountedQty;
                        }
                    }
                    
                    itemizedData.push({
                        "Receipt Number": r.receiptNumber || 'N/A',
                        "Date": r.createdAt ? format(toJsDate(r.createdAt)!, 'MM/dd/yy p') : 'N/A',
                        "Item Name": line.itemName,
                        "Category": line.category || 'N/A',
                        "Quantity": billableQty,
                        "Unit Price": line.unitPrice || 0,
                        "Line Total": lineTotal,
                        "Discount Applied": discountAmount,
                        "Free Quantity": line.freeQty || 0,
                    });
                });
            }
        });

        const summarySheet = XLSX.utils.json_to_sheet(summaryData);
        const itemizedSheet = XLSX.utils.json_to_sheet(itemizedData);
        
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, summarySheet, "Receipts Summary");
        XLSX.utils.book_append_sheet(workbook, itemizedSheet, "Itemized Sales");
        
        XLSX.writeFile(workbook, "receipts_export.xlsx");
        toast({ title: "Export Started", description: "Your download will begin shortly." });
    };

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

    if (storeLoading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;
    }

    if (!activeStore) {
        return (
            <Card className="w-full max-w-md mx-auto text-center"><CardHeader><CardTitle>No Store Selected</CardTitle><CardDescription>Please select a store to view receipts.</CardDescription></CardHeader></Card>
        );
    }
    
    return (
        <RoleGuard allow={["admin", "manager", "cashier"]}>
            <PageHeader title="Receipts" description="Browse, preview, and reprint past receipts.">
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handleExport} disabled={filteredReceipts.length === 0}><Download className="mr-2"/> Export</Button>
                    <Button onClick={() => setIsSettingsOpen(true)}><Settings className="mr-2"/> Receipt Settings</Button>
                </div>
            </PageHeader>
            
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-6">
                <div className="relative flex-1 w-full sm:w-auto">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search by Receipt #, Table, Customer..." className="pl-8" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex flex-col items-start sm:items-end gap-2">
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
                     <p className="text-sm text-muted-foreground text-right">{dateRangeLabel}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Transactions</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoadingReceipts ? <div className="flex justify-center p-8"><Loader2 className="mx-auto animate-spin" /></div> : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Identifier</TableHead>
                                        <TableHead className="text-right">Subtotal</TableHead>
                                        <TableHead className="text-right">Discounts</TableHead>
                                        <TableHead className="text-right">Charges</TableHead>
                                        <TableHead className="text-right">Total</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredReceipts.map(r => (
                                        <TableRow 
                                            key={r.id} 
                                            onClick={() => handleSelectReceipt(r.id)}
                                            className={cn("cursor-pointer", selectedReceiptId === r.id && "bg-muted")}
                                        >
                                            <TableCell className="font-medium py-2">
                                                <div>{r.receiptNumber || `Tbl ${r.tableNumber}` || r.customerName}</div>
                                                <div className="text-xs text-muted-foreground">{r.createdByUsername || 'N/A'} - {format(toJsDate(r.createdAt)!, 'p')}</div>
                                            </TableCell>
                                            <TableCell className="text-right py-2">₱{(r.analytics?.subtotal ?? 0).toFixed(2)}</TableCell>
                                            <TableCell className="text-right py-2 text-destructive">₱{(r.analytics?.discountsTotal ?? 0).toFixed(2)}</TableCell>
                                            <TableCell className="text-right py-2 text-green-600">₱{(r.analytics?.chargesTotal ?? 0).toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-bold py-2">₱{r.total.toFixed(2)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                         {filteredReceipts.length === 0 && !isLoadingReceipts && <p className="text-center text-muted-foreground py-10">No receipts found for this period.</p>}
                    </CardContent>
                </Card>

                <div className="sticky top-20">
                     <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Preview</CardTitle>
                            <Button onClick={handlePrint} disabled={!selectedReceiptData || isPrinting}>
                                {isPrinting ? <Loader2 className="mr-2 animate-spin" /> : <Printer className="mr-2"/>} Reprint
                            </Button>
                        </CardHeader>
                        <CardContent id="print-receipt-area" className="bg-gray-100 dark:bg-gray-800 p-2 rounded-b-lg">
                        {isLoadingPreview ? <div className="flex justify-center p-8"><Loader2 className="animate-spin"/></div> : selectedReceiptData ? (
                            <ReceiptView data={selectedReceiptData} paymentMethods={paymentMethods} />
                        ) : (
                            <div className="text-center text-muted-foreground py-20">Select a receipt to preview</div>
                        )}
                        </CardContent>
                    </Card>
                </div>
            </div>
            
            <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DialogContent className="max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[90vh]">
                    <DialogHeader className="p-6 pb-0">
                        <DialogTitle>Receipt Template Settings</DialogTitle>
                        <DialogDescription>Manage the look and feel of your printed receipts for {activeStore.name}. Changes are saved automatically.</DialogDescription>
                    </DialogHeader>
                     <div className="overflow-y-auto px-6">
                        <ReceiptTemplateSettings store={activeStore} form={form} />
                     </div>
                     <div className="p-6 pt-0">
                        <DialogClose asChild><Button type="button" variant="secondary">Close</Button></DialogClose>
                     </div>
                </DialogContent>
            </Dialog>

            {/* This div is only for printing */}
            <div className="hidden print-block">
                {selectedReceiptData && <ReceiptView data={selectedReceiptData} paymentMethods={paymentMethods} />}
            </div>
        </RoleGuard>
    )
}

export default function ReceiptsPage() {
    return (
        <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>}>
            <ReceiptsPageContents />
        </React.Suspense>
    )
}
