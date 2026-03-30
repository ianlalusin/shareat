
"use client";

import type { Discount, Charge, Receipt as ReceiptType, ModeOfPayment, Store, SessionBillLine } from "@/lib/types";
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
import { Loader2, Printer, Search, Settings, Download, Calendar as CalendarIcon, Trash2, Edit, Ban, ArrowLeft, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useStoreContext } from "@/context/store-context";
import { db } from "@/lib/firebase/client";
import { collection, query, orderBy, onSnapshot, doc, getDoc, updateDoc, increment, serverTimestamp, where, Timestamp, deleteDoc, writeBatch, limit, startAfter, getDocs, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { format } from "date-fns";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { ReceiptView } from "@/components/receipt/receipt-view";
import { ReceiptSettings as ReceiptTemplateSettings } from "@/components/manager/store-settings/receipt-settings";
import { EditReceiptDialog } from "@/components/receipts/EditReceiptDialog";
import { RefundReceiptDialog } from "@/components/receipts/RefundReceiptDialog";
import { useAuthContext } from "@/context/auth-context";
import { toJsDate } from "@/lib/utils/date";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";
import { writeActivityLog } from "@/components/cashier/activity-log";
import { exportToXlsx } from "@/lib/export/export-xlsx-client";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { applyAnalyticsDeltaV2 } from "@/lib/analytics/applyAnalyticsDeltaV2";
import { v4 as uuidv4 } from "uuid";
import { Badge } from "@/components/ui/badge";
import ReasonModal from "@/components/shared/ReasonModal";
import type { ReceiptData } from "@/lib/types";
import { useReceiptSettings } from "@/hooks/use-receipt-settings";
import { usePrint } from "@/hooks/use-print";


// --- Date Helpers ---
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function isSameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
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



export default function ReceiptsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
    const { appUser, isSigningOut } = useAuthContext();
    const { activeStore, loading: storeLoading } = useStoreContext();
    
    const [receipts, setReceipts] = useState<ReceiptType[]>([]);
    const [isLoadingReceipts, setIsLoadingReceipts] = useState(true);
    const [isExporting, setIsExporting] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
    const [selectedReceiptData, setSelectedReceiptData] = useState<Omit<ReceiptData, 'settings'> | null>(null);
    const [editingReceipt, setEditingReceipt] = useState<ReceiptType | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [isProcessing, setIsProcessing] = useState<string | null>(null);
    
    const { settings, isLoading: settingsLoading } = useReceiptSettings(activeStore?.id);
    const { printReceipt, isPrinting } = usePrint({ receiptData: selectedReceiptData as ReceiptData | null, storeId: activeStore?.id, sessionId: selectedReceiptId, appUser });

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);

    const [voidOpen, setVoidOpen] = useState(false);
    const [voidTarget, setVoidTarget] = useState<ReceiptType | null>(null);
    const [refundTarget, setRefundTarget] = useState<ReceiptType | null>(null);

    // --- Pagination State ---
    const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const PAGE_SIZE = 20;

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
    
    useEffect(() => {
        if (!searchParams) return;
      
        const rid = searchParams.get("rid");
        if (rid) setSelectedReceiptId(rid);
      }, [searchParams]);

    const fetchReceipts = useCallback(async (loadMore = false) => {
        if (!activeStore || !appUser) return;

        if (loadMore) setIsLoadingMore(true);
        else setIsLoadingReceipts(true);

        let q = query(
            collection(db, "stores", activeStore.id, "receipts"), 
            where("createdAt", ">=", start),
            where("createdAt", "<=", end),
            orderBy("createdAt", "desc"),
            limit(PAGE_SIZE)
        );

        if (loadMore && lastDoc) {
            q = query(q, startAfter(lastDoc));
        }

        try {
            const snapshot = await getDocs(q);
            const newReceipts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ReceiptType));
            
            setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
            setHasMore(snapshot.docs.length === PAGE_SIZE);
            
            setReceipts(prev => loadMore ? [...prev, ...newReceipts] : newReceipts);

        } catch (error) {
            if (isSigningOut) return;
            console.error("Error fetching receipts:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch receipts.' });
        } finally {
            setIsLoadingReceipts(false);
            setIsLoadingMore(false);
        }
    }, [activeStore, start, end, lastDoc, toast, appUser, isSigningOut]);
      
    // Effect for initial load and date/store changes
    useEffect(() => {
        setReceipts([]);
        setLastDoc(null);
        setHasMore(true);
        fetchReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeStore, start, end]);

    useEffect(() => {
        if (!activeStore?.id) return;
        const unsubPm = onSnapshot(
            query(collection(db, "stores", activeStore.id, "storeModesOfPayment"), where("isArchived", "==", false), orderBy("sortOrder")),
            snap => setPaymentMethods(snap.docs.map(d => ({id: d.id, ...d.data()}) as ModeOfPayment)),
            (err) => {
                if (isSigningOut || !appUser) return;
                console.error("MOP listener error:", err);
            }
        );
        return () => unsubPm();
    }, [activeStore?.id, appUser, isSigningOut]);
    
    const [discounts, setDiscounts] = React.useState<Discount[]>([]);
    const [charges, setCharges] = React.useState<Charge[]>([]);
     useEffect(() => {
        if (!activeStore?.id) return;
        const handleError = (err: any) => {
            if(isSigningOut || !appUser) return;
            console.error("Collections listener error:", err);
        }
        const unsubDiscounts = onSnapshot(
            query(collection(db, "stores", activeStore.id, "storeDiscounts"), where("isArchived", "==", false), where("isEnabled", "==", true)),
            snap => setDiscounts(snap.docs.map(d => ({id: d.id, ...d.data()}) as Discount)),
            handleError
        );
         const unsubCharges = onSnapshot(
            query(collection(db, "stores", activeStore.id, "storeCharges"), where("isArchived", "==", false), where("isEnabled", "==", true)),
            snap => setCharges(snap.docs.map(d => ({id: d.id, ...d.data()}) as Charge)),
            handleError
        );
        return () => {
            unsubDiscounts();
            unsubCharges();
        };
    }, [activeStore?.id, appUser, isSigningOut]);

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

    const handleEditReceipt = (receipt: ReceiptType) => {
        setEditingReceipt(receipt);
    }

    const handleSaveCorrection = async (updatedReceiptData: Partial<ReceiptType>, reason: string) => {
      if (!appUser || !activeStore || !editingReceipt) return;
    
      try {
        const batch = writeBatch(db);
        const originalReceiptRef = doc(db, "stores", activeStore.id, "receipts", editingReceipt.id);
    
        const nextVersion = (editingReceipt.editVersion || 0) + 1;
        const revisionId = `v${nextVersion}_${format(new Date(), "yyyyMMddHHmmss")}`;
        const revisionRef = doc(originalReceiptRef, "revisions", revisionId);
    
        // 1. Create a revision document with a snapshot of the original receipt data.
        batch.set(revisionRef, {
          version: nextVersion,
          editedAt: serverTimestamp(),
          editedByUid: appUser.uid,
          editedByEmail: appUser.email,
          reason,
          snapshot: editingReceipt, // The original, unedited data
        });
        
        const applyId = uuidv4();
    
        // 2. Prepare the final updated receipt object for writing.
        const finalReceiptPayload = {
          ...updatedReceiptData,
          isEdited: true,
          editVersion: nextVersion,
          editedAt: new Date(), // Use JS Date for immediate state update
          editedByUid: appUser.uid,
          editedByEmail: appUser.email,
          editReason: reason,
          analyticsApplied: true, // Mark analytics as applied
          analyticsAppliedAt: serverTimestamp(),
          analyticsApplyId: applyId,
        };
        batch.update(originalReceiptRef, { ...finalReceiptPayload, editedAt: serverTimestamp() }); // Use serverTimestamp for DB
    
        // 3. Calculate and apply the analytics delta within the same atomic batch.
        await applyAnalyticsDeltaV2(
          db,
          activeStore.id,
          editingReceipt, // Pass the original receipt as the "before" state
          updatedReceiptData as ReceiptType, // Pass the new data as the "after" state
          { batch } // Join the existing batch
        );
    
        // 4. Commit all operations atomically.
        await batch.commit();

        // 5. Update local state immediately after successful commit
        setReceipts(prev =>
            prev.map(r => r.id === editingReceipt!.id ? ({ ...r, ...finalReceiptPayload } as ReceiptType) : r)
        );

        if (selectedReceiptId === editingReceipt.id) {
            setIsLoadingPreview(true);
            const receiptSnap = await getDoc(doc(db, "stores", activeStore.id, "receipts", editingReceipt.id));
            if (receiptSnap.exists()) {
                const receiptDocData = receiptSnap.data({ serverTimestamps: "estimate" }) as any;
                setSelectedReceiptData(prev => prev ? ({
                ...prev,
                lines: receiptDocData.lines || [],
                analytics: receiptDocData.analytics,
                payments: Object.entries(receiptDocData.analytics?.mop || {}).map(([key, value]) => ({ methodId: key, amount: value as number })),
                }) : prev);
            }
            setIsLoadingPreview(false);
        }
    
        // 6. Log the successful activity (this can happen outside the batch).
        await writeActivityLog({
          action: "RECEIPT_EDITED",
          storeId: activeStore.id,
          sessionId: editingReceipt.sessionId,
          user: appUser,
          meta: {
            receiptId: editingReceipt.id,
            receiptNumber: editingReceipt.receiptNumber,
            editVersion: nextVersion,
            reason: reason,
          },
        });
    
        toast({ title: "Receipt Updated", description: "The correction has been saved and audited." });
        setEditingReceipt(null); // Close the dialog
      } catch (error: any) {
        console.error("handleSaveCorrection error:", error);
        toast({ variant: "destructive", title: "Correction Failed", description: error.message });
        throw error; // Re-throw to indicate failure to the caller
      }
    };


    useEffect(() => {
        if (!selectedReceiptId || !activeStore) {
            setSelectedReceiptData(null);
            return;
        }
        setIsLoadingPreview(true);
        const fetchReceiptDetails = async () => {
             try {
                const receiptSnap = await getDoc(doc(db, "stores", activeStore.id, "receipts", selectedReceiptId));
                
                if (!receiptSnap.exists()) throw new Error("Receipt not found.");

                const receiptDocData = receiptSnap.data({ serverTimestamps: "estimate" }) as any;
                
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
                    store: activeStore as Store,
                    receiptCreatedAt: receiptDocData.createdAt,
                    createdByUsername: receiptDocData.createdByUsername,
                    receiptNumber: receiptDocData.receiptNumber,
                    analytics: receiptDocData.analytics,
                    isRefund: receiptDocData.isRefund ?? false,
                    createdByEmail: receiptDocData.createdByEmail ?? null,
                } as any);
                
            } catch (err: any) {
                toast({ variant: 'destructive', title: 'Error loading preview', description: err.message });
                setSelectedReceiptData(null);
            } finally {
                setIsLoadingPreview(false);
            }
        };
        fetchReceiptDetails();
    }, [selectedReceiptId, activeStore, toast]);
    

    const handleVoidReceipt = async (receipt: ReceiptType, reason: string) => {
      if (!appUser || !activeStore) {
        throw new Error("User or store not available.");
      }
    
      if (receipt.status === "voided") {
        toast({ title: "Already voided", description: "This receipt was already voided." });
        return;
      }
      
      try {
        const batch = writeBatch(db);
        const receiptRef = doc(db, "stores", activeStore.id, "receipts", receipt.id);
      
        await applyAnalyticsDeltaV2(db, activeStore.id, receipt, null, { batch });
        
        const applyId = uuidv4();
      
        batch.update(receiptRef, {
          status: "voided",
          voidedAt: serverTimestamp(),
          voidedByUid: appUser.uid,
          voidedByEmail: appUser.email,
          voidReason: reason,
          analyticsApplied: true,
          analyticsAppliedAt: serverTimestamp(),
          analyticsApplyId: applyId,
        });
      
        await batch.commit();
      
        await writeActivityLog({
          action: "RECEIPT_VOIDED",
          storeId: activeStore.id,
          sessionId: receipt.sessionId,
          user: appUser,
          reason,
          meta: { 
            receiptId: receipt.id, 
            receiptNumber: receipt.receiptNumber,
            total: receipt.total,
          },
        });
      } catch (error) {
          console.error("Error voiding receipt:", error);
          // Re-throw the error so the caller can handle it (e.g., show a toast)
          throw error;
      }
    };

    const handleExport = async () => {
        if (!activeStore) return;
        setIsExporting(true);

        try {
            const allReceiptsQuery = query(
                collection(db, "stores", activeStore.id, "receipts"),
                where("createdAt", ">=", start),
                where("createdAt", "<=", end),
                orderBy("createdAt", "desc")
            );
            
            const snapshot = await getDocs(allReceiptsQuery);
            const allReceipts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ReceiptType));
            
            if (allReceipts.length === 0) {
                 toast({ description: "No data to export for the selected range." });
                 setIsExporting(false);
                 return;
            }

            // Sheet 1: Summary Data
            const summaryData = allReceipts.map(r => {
                const date = toJsDate(r.createdAt);
                return {
                    "Receipt #": r.receiptNumber || 'N/A',
                    "Date": date ? format(date, 'yyyyMMdd') : 'N/A',
                    "Time": date ? format(date, 'HH:mm:ss') : 'N/A',
                    "Customer Name": r.customerName || 'N/A',
                    "Address": r.customerAddress || 'N/A',
                    "TIN": r.customerTin || 'N/A',
                    "Table No.": r.tableNumber || 'N/A',
                    "Package": r.lines?.find(l => l.type === 'package')?.itemName || 'Ala Carte',
                    "Subtotal": r.analytics?.subtotal ?? 0,
                    "Discount": r.analytics?.discountsTotal ?? 0,
                    "Charges": r.analytics?.chargesTotal ?? 0,
                    "VAT": r.analytics?.taxAmount ?? 0,
                    "Total": r.total,
                    "Paid": r.totalPaid,
                    "Mode of Payment": Object.keys(r.analytics?.mop || {}).join(', '),
                };
            });
        
            // Sheet 2: Itemized Data
            const itemizedData: any[] = [];
            allReceipts.forEach(r => {
                const date = toJsDate(r.createdAt);
                (r.lines as SessionBillLine[])?.forEach(line => {
                    const billableQty = line.qtyOrdered - (line.voidedQty || 0);
                    if (billableQty <= 0) return; // Skip voided/zero-qty lines

                    const lineSubtotal = billableQty * line.unitPrice;
                    let lineDiscount = 0;
                    if ((line.discountValue ?? 0) > 0 && line.discountQty > 0) {
                         const discountedQty = Math.min(line.discountQty, billableQty);
                         if (line.discountType === 'percent') {
                             lineDiscount = discountedQty * line.unitPrice * (line.discountValue! / 100);
                         } else {
                             lineDiscount = discountedQty * line.discountValue!;
                         }
                    }
                    
                    itemizedData.push({
                        "Receipt #": r.receiptNumber || 'N/A',
                        "Date": date ? format(date, 'yyyyMMdd') : 'N/A',
                        "Time": date ? format(date, 'HH:mm:ss') : 'N/A',
                        "QTY": billableQty,
                        "Package/Add-on": line.itemName,
                        "Price": line.unitPrice,
                        "Discount": lineDiscount,
                        "Subtotal": lineSubtotal - lineDiscount,
                    });
                });
            });
        
            await exportToXlsx({
                sheets: [
                    { data: summaryData, name: "Summary" },
                    { data: itemizedData, name: "Items" }
                ],
                filename: `Receipts_${activeStore.code}_${format(start, 'yyyyMMdd')}_${format(end, 'yyyyMMdd')}.xlsx`,
            });
        } catch (error: any) {
             toast({ variant: 'destructive', title: 'Export Failed', description: error.message });
        } finally {
            setIsExporting(false);
        }
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

    const handleVoidClick = (r: ReceiptType) => {
      setVoidTarget(r);
      setVoidOpen(true);
    };

    if (storeLoading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;
    }

    if (!activeStore) {
        return (
            <Card className="w-full max-w-md mx-auto text-center">
                <CardHeader>
                    <CardTitle>No Store Selected</CardTitle>
                    <CardDescription>Please select a store to view receipts.</CardDescription>
                </CardHeader>
            </Card>
        );
    }
    
    return (
        <RoleGuard allow={["admin", "manager", "cashier"]}>
            <div className="no-print">
                <PageHeader title="Receipts" description="Browse, preview, and reprint past receipts.">
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => router.back()}>
                            <ArrowLeft className="mr-2 h-4 w-4" /> Back
                        </Button>
                        <Button onClick={handleExport} disabled={isExporting || isLoadingReceipts || filteredReceipts.length === 0} variant="outline">
                            {isExporting ? <Loader2 className="mr-2 animate-spin"/> : <Download className="mr-2" />}
                            Export
                        </Button>
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
                                            <TableHead>Total</TableHead>
                                            {(appUser?.role === 'admin' || appUser?.role === 'manager') && <TableHead className="text-right">Actions</TableHead>}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredReceipts.map(r => {
                                            const isVoidDisabled =
                                                (isProcessing === r.id) ||
                                                (r.status === "voided") ||
                                                ((appUser?.role || "").toLowerCase() === "manager" && r.isEdited === true);
                                            return (
                                            <TableRow 
                                                key={r.id} 
                                                onClick={(e) => {
                                                    const el = e.target as HTMLElement;
                                                    if (el.closest("button")) return;
                                                    handleSelectReceipt(r.id);
                                                }}
                                                className={cn("cursor-pointer", selectedReceiptId === r.id && "bg-muted", r.status === 'voided' && 'text-muted-foreground line-through')}
                                            >
                                                <TableCell className="font-medium py-2">
                                                    <div>{r.receiptNumber || `Tbl ${r.tableNumber}` || r.customerName} {r.status === 'voided' && <Badge variant="destructive">VOIDED</Badge>}{r.isRefund && <Badge variant="secondary" className="ml-1">REFUND</Badge>}</div>
                                                    <div className="text-xs">{r.createdByUsername || 'N/A'} - {format(toJsDate(r.createdAt)!, 'p')}</div>
                                                </TableCell>
                                                <TableCell className="font-bold py-2">₱{r.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                {(appUser?.role === 'admin' || appUser?.role === 'manager') && (
                                                    <TableCell
                                                        className="text-right py-2"
                                                    >
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleEditReceipt(r); }}
                                                            className="mr-2"
                                                            disabled={r.status === "voided" || !!r.isRefund}
                                                            type="button"
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRefundTarget(r); }}
                                                            disabled={r.status === "voided" || !!r.isRefund}
                                                            className="mr-2"
                                                            title="Issue Refund"
                                                            type="button"
                                                        >
                                                            <RotateCcw className="h-4 w-4" />
                                                        </Button>
                                                        {(appUser?.role === "admin" || appUser?.role === "manager") && (
                                                            <Button
                                                                variant="destructive"
                                                                size="sm"
                                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleVoidClick(r); }}
                                                                disabled={isVoidDisabled}
                                                                type="button"
                                                            >
                                                                {isProcessing === r.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Ban className="h-4 w-4"/>}
                                                            </Button>
                                                        )}
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                        )})}
                                    </TableBody>
                                </Table>
                            )}
                             {filteredReceipts.length === 0 && !isLoadingReceipts && <p className="text-center text-muted-foreground py-10">No receipts found for this period.</p>}
                             {hasMore && !isLoadingReceipts && (
                                <div className="text-center py-4">
                                    <Button onClick={() => fetchReceipts(true)} disabled={isLoadingMore}>
                                        {isLoadingMore ? <Loader2 className="animate-spin mr-2"/> : null}
                                        Load More
                                    </Button>
                                </div>
                             )}
                        </CardContent>
                    </Card>

                    <div className="sticky top-20">
                         <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle>Preview</CardTitle>
                                <Button onClick={printReceipt} disabled={!selectedReceiptData || isPrinting || settingsLoading}>
                                    {isPrinting || settingsLoading ? <Loader2 className="mr-2 animate-spin" /> : <Printer className="mr-2"/>} Reprint
                                </Button>
                            </CardHeader>
                            <CardContent id="print-receipt-area" className="bg-gray-100 dark:bg-gray-800 p-2 rounded-b-lg">
                            {isLoadingPreview ? <div className="flex justify-center p-8"><Loader2 className="animate-spin"/></div> : selectedReceiptData && settings ? (
                                <ReceiptView data={{ ...selectedReceiptData, settings }} paymentMethods={paymentMethods} />
                            ) : (
                                <div className="text-center text-muted-foreground py-20">Select a receipt to preview</div>
                            )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
            
            <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DialogContent className="max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[90vh]">
                    <DialogHeader className="p-6 pb-0">
                        <DialogTitle>Receipt Template Settings</DialogTitle>
                        <DialogDescription>Manage the look and feel of your printed receipts for {activeStore.name}. Changes are saved automatically.</DialogDescription>
                    </DialogHeader>
                     <div className="overflow-y-auto px-6">
                        <ReceiptTemplateSettings store={activeStore} />
                     </div>
                     <div className="p-6 pt-0">
                        <DialogClose asChild><Button type="button" variant="secondary">Close</Button></DialogClose>
                     </div>
                </DialogContent>
            </Dialog>

             {editingReceipt && activeStore && (
                <EditReceiptDialog
                    isOpen={!!editingReceipt}
                    onClose={() => setEditingReceipt(null)}
                    receipt={editingReceipt}
                    store={activeStore}
                    discounts={discounts}
                    charges={charges}
                    paymentMethods={paymentMethods}
                    onSave={handleSaveCorrection}
                />
            )}

            <ReasonModal
              open={voidOpen}
              onOpenChange={(o) => {
                setVoidOpen(o);
                if (!o) setVoidTarget(null);
              }}
              title="Void Receipt"
              description="Provide a reason. This will reverse analytics and keep the receipt for audit."
              confirmLabel="Void Receipt"
              placeholder="Reason..."
              onConfirm={async (reason) => {
                if (!voidTarget) return;
                setIsProcessing(voidTarget.id);
                try {
                  await handleVoidReceipt(voidTarget, reason);
                  toast({ title: "Receipt Voided", description: "Receipt kept for audit; analytics reversed." });
                  setReceipts(prev => prev.map(r => r.id === voidTarget!.id ? { ...r, status: 'voided', voidReason: reason } : r));
                } catch (error: any) {
                    toast({ variant: 'destructive', title: 'Void Failed', description: error.message });
                } finally {
                  setIsProcessing(null);
                  setVoidTarget(null);
                }
              }}
            />

            {/* This div is only for printing */}
            <div id="receipt-print-root" className="hidden">
                {selectedReceiptData && settings && <ReceiptView data={{...selectedReceiptData, settings}} paymentMethods={paymentMethods} />}
            </div>
            {ConfirmDialog}
            {refundTarget && appUser && (
                <RefundReceiptDialog
                    isOpen={!!refundTarget}
                    onClose={() => setRefundTarget(null)}
                    receipt={refundTarget}
                    paymentMethods={paymentMethods}
                    actor={appUser}
                    onSuccess={(refundId) => {
                        fetchReceipts();
                    }}
                />
            )}
        </RoleGuard>
    )
}


    