

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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Printer, Search, Settings, Download, Calendar as CalendarIcon, Trash2, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useStoreContext } from "@/context/store-context";
import { db } from "@/lib/firebase/client";
import { collection, query, orderBy, onSnapshot, doc, getDoc, updateDoc, increment, serverTimestamp, where, Timestamp, deleteDoc, writeBatch, limit, startAfter, getDocs, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { format } from "date-fns";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { ReceiptView, type ReceiptData } from "@/components/receipt/receipt-view";
import { ReceiptSettings as ReceiptTemplateSettings, receiptSettingsSchema } from "@/components/receipts/ReceiptTemplateSettings";
import { EditReceiptDialog } from "@/components/receipts/EditReceiptDialog";
import { useAuthContext } from "@/context/auth-context";
import { toJsDate } from "@/lib/utils/date";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";
import { writeActivityLog } from "@/components/cashier/activity-log";
import { exportToXlsx } from "@/lib/export/export-xlsx-client";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { diff } from 'deep-object-diff';
import { getPaymentContribution, getGuestCoversContribution, getSalesContribution, getPeakHourContribution, dailyAnalyticsDocRef, getClosedSessionsContribution, getRefillContribution } from "@/lib/analytics/daily";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

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


function getUsername(appUser: any) {
  return (appUser?.displayName?.trim())
    || (appUser?.name?.trim())
    || (appUser?.email ? String(appUser.email).split("@")[0] : "")
    || (appUser?.uid ? String(appUser.uid).slice(0,6) : "unknown");
}

async function applyAnalyticsDelta(
  storeId: string,
  oldReceipt: ReceiptType | null,
  newReceipt: ReceiptType | null
) {
  const oldC = {
    guest: getGuestCoversContribution(oldReceipt),
    sales: getSalesContribution(oldReceipt),
    peak: getPeakHourContribution(oldReceipt),
    closed: getClosedSessionsContribution(oldReceipt),
    refill: getRefillContribution(oldReceipt),
  };
  const newC = {
    guest: getGuestCoversContribution(newReceipt),
    sales: getSalesContribution(newReceipt),
    peak: getPeakHourContribution(newReceipt),
    closed: getClosedSessionsContribution(newReceipt),
    refill: getRefillContribution(newReceipt),
  };

  const updates: { ref: any, payload: any }[] = [];

  const processDelta = (oldContrib: any, newContrib: any) => {
    if (oldContrib.dayId && oldContrib.dayId !== newContrib.dayId) {
      // Day changed, so subtract from old day
      const oldPayload: Record<string, any> = {};
      if (oldContrib.guestCountFinal) oldPayload['guests.guestCountFinalTotal'] = increment(-oldContrib.guestCountFinal);
      if (oldContrib.packageSessionsCount) oldPayload['guests.packageSessionsCount'] = increment(-oldContrib.packageSessionsCount);
      if (oldContrib.packageName) oldPayload[`guests.packageCoversBilledByPackageName.${oldContrib.packageName}`] = increment(-oldContrib.billedPackageCovers);
      
      if (oldContrib.packageAmountByName) for (const [k,v] of Object.entries(oldContrib.packageAmountByName)) oldPayload[`sales.packageSalesAmountByName.${k}`] = increment(-(v as number));
      if (oldContrib.packageQtyByName) for (const [k,v] of Object.entries(oldContrib.packageQtyByName)) oldPayload[`sales.packageSalesQtyByName.${k}`] = increment(-(v as number));
      if (oldContrib.addonAmountByCategory) for (const [k,v] of Object.entries(oldContrib.addonAmountByCategory)) oldPayload[`sales.addonSalesAmountByCategory.${k}`] = increment(-(v as number));
      if (oldContrib.hourKey) {
        oldPayload[`sales.salesAmountByHour.${oldContrib.hourKey}`] = increment(-oldContrib.amount);
        oldPayload[`sales.sessionCountByHour.${oldContrib.hourKey}`] = increment(-oldContrib.count);
      }
      if (oldContrib.closedCount) {
          oldPayload['sessions.closedCount'] = increment(-oldContrib.closedCount);
          oldPayload['sessions.totalPaid'] = increment(-oldContrib.totalPaid);
      }
      if (oldContrib.packageSessionsCount) {
          oldPayload['refills.packageSessionsCount'] = increment(-oldContrib.packageSessionsCount);
          oldPayload['refills.servedRefillsTotal'] = increment(-oldContrib.servedRefillsTotal);
          for (const [k,v] of Object.entries(oldContrib.servedRefillsByName)) oldPayload[`refills.servedRefillsByName.${k}`] = increment(-(v as number));
      }

      updates.push({ ref: dailyAnalyticsDocRef(db, storeId, oldContrib.dayId), payload: oldPayload });
    }

    const payload: Record<string, any> = {};
    const deltaGuestCount = newContrib.guestCountFinal - oldContrib.guestCountFinal;
    const deltaPackageSessions = newContrib.packageSessionsCount - oldContrib.packageSessionsCount;

    if (deltaGuestCount) payload['guests.guestCountFinalTotal'] = increment(deltaGuestCount);
    if (deltaPackageSessions) payload['guests.packageSessionsCount'] = increment(deltaPackageSessions);
    
    // Package Covers by Name
    const allPkgNames = new Set([...Object.keys(oldContrib.packageAmountByName || {}), ...Object.keys(newContrib.packageAmountByName || {})]);
    allPkgNames.forEach(name => {
        const oldVal = oldContrib.packageAmountByName?.[name] || 0;
        const newVal = newContrib.packageAmountByName?.[name] || 0;
        if(oldVal !== newVal) payload[`sales.packageSalesAmountByName.${name}`] = increment(newVal - oldVal);

        const oldQty = oldContrib.packageQtyByName?.[name] || 0;
        const newQty = newContrib.packageQtyByName?.[name] || 0;
        if(oldQty !== newQty) payload[`sales.packageSalesQtyByName.${name}`] = increment(newQty - oldQty);
    });

    // Addon Sales by Category
    const allCategories = new Set([...Object.keys(oldContrib.addonAmountByCategory || {}), ...Object.keys(newContrib.addonAmountByCategory || {})]);
    allCategories.forEach(cat => {
        const oldVal = oldContrib.addonAmountByCategory?.[cat] || 0;
        const newVal = newContrib.addonAmountByCategory?.[cat] || 0;
        if(oldVal !== newVal) payload[`sales.addonSalesAmountByCategory.${cat}`] = increment(newVal - oldVal);
    });

    // Peak Hour
    if (oldContrib.hourKey !== newContrib.hourKey) {
        if(oldContrib.hourKey) {
          payload[`sales.salesAmountByHour.${oldContrib.hourKey}`] = increment(-oldContrib.amount);
          payload[`sales.sessionCountByHour.${oldContrib.hourKey}`] = increment(-oldContrib.count);
        }
        if(newContrib.hourKey) {
          payload[`sales.salesAmountByHour.${newContrib.hourKey}`] = increment(newContrib.amount);
          payload[`sales.sessionCountByHour.${newContrib.hourKey}`] = increment(newContrib.count);
        }
    } else if (newContrib.hourKey && (oldContrib.amount !== newContrib.amount)) {
        payload[`sales.salesAmountByHour.${newContrib.hourKey}`] = increment(newContrib.amount - oldContrib.amount);
    }
    
    // Closed Sessions
    const deltaClosedCount = newContrib.closedCount - oldContrib.closedCount;
    if(deltaClosedCount) payload['sessions.closedCount'] = increment(deltaClosedCount);
    const deltaTotalPaid = newContrib.totalPaid - oldContrib.totalPaid;
    if(deltaTotalPaid) payload['sessions.totalPaid'] = increment(deltaTotalPaid);
    
    // Refills
    const deltaRefillSessions = newContrib.packageSessionsCount - oldContrib.packageSessionsCount;
    const deltaRefillTotal = newContrib.servedRefillsTotal - oldContrib.servedRefillsTotal;
    if (deltaRefillSessions) payload['refills.packageSessionsCount'] = increment(deltaRefillSessions);
    if (deltaRefillTotal) payload['refills.servedRefillsTotal'] = increment(deltaRefillTotal);

    const allRefillNames = new Set([...Object.keys(oldContrib.servedRefillsByName || {}), ...Object.keys(newContrib.servedRefillsByName || {})]);
    allRefillNames.forEach(name => {
        const oldQty = oldContrib.servedRefillsByName?.[name] || 0;
        const newQty = newContrib.servedRefillsByName?.[name] || 0;
        if(oldQty !== newQty) payload[`refills.servedRefillsByName.${name}`] = increment(newQty - oldQty);
    });

    if (Object.keys(payload).length > 0) {
        updates.push({ ref: dailyAnalyticsDocRef(db, storeId, newContrib.dayId), payload });
    }
  }

  processDelta({ ...oldC.guest, ...oldC.sales, ...oldC.peak, ...oldC.closed, ...oldC.refill }, { ...newC.guest, ...newC.sales, ...newC.peak, ...newC.closed, ...newC.refill });

  if (updates.length === 0) return;

  const batch = writeBatch(db);
  for (const { ref, payload } of updates) {
    batch.update(ref, payload);
  }
  await batch.commit();
}


export default function ReceiptsPageContents() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
    const { appUser } = useAuthContext();
    const { activeStore, loading: storeLoading } = useStoreContext();

    const [receipts, setReceipts] = useState<ReceiptType[]>([]);
    const [isLoadingReceipts, setIsLoadingReceipts] = useState(true);
    const [isExporting, setIsExporting] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
    const [selectedReceiptData, setSelectedReceiptData] = useState<ReceiptData | null>(null);
    const [editingReceipt, setEditingReceipt] = useState<ReceiptType | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);

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

    const fetchReceipts = useCallback(async (loadMore = false) => {
        if (!activeStore) return;

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
            console.error("Error fetching receipts:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch receipts.' });
        } finally {
            setIsLoadingReceipts(false);
            setIsLoadingMore(false);
        }
    }, [activeStore, start, end, lastDoc, toast]);
      
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
            snap => setPaymentMethods(snap.docs.map(d => ({id: d.id, ...d.data()}) as ModeOfPayment))
        );
        return () => unsubPm();
    }, [activeStore?.id]);
    
    const [discounts, setDiscounts] = React.useState<Discount[]>([]);
    const [charges, setCharges] = React.useState<Charge[]>([]);
     useEffect(() => {
        if (!activeStore?.id) return;
        const unsubDiscounts = onSnapshot(
            query(collection(db, "stores", activeStore.id, "storeDiscounts"), where("isArchived", "==", false), where("isEnabled", "==", true)),
            snap => setDiscounts(snap.docs.map(d => ({id: d.id, ...d.data()}) as Discount))
        );
         const unsubCharges = onSnapshot(
            query(collection(db, "stores", activeStore.id, "storeCharges"), where("isArchived", "==", false), where("isEnabled", "==", true)),
            snap => setCharges(snap.docs.map(d => ({id: d.id, ...d.data()}) as Charge))
        );
        return () => {
            unsubDiscounts();
            unsubCharges();
        };
    }, [activeStore?.id]);

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

    const handleSaveCorrection = async (updatedReceipt: Partial<ReceiptType>, reason: string) => {
        if (!appUser || !activeStore || !editingReceipt) return;

        try {
            const batch = writeBatch(db);
            const originalReceiptRef = doc(db, "stores", activeStore.id, "receipts", editingReceipt.id);
            
            const nextVersion = (editingReceipt.editVersion || 0) + 1;
            const revisionId = `v${nextVersion}_${format(new Date(), "yyyyMMddHHmmss")}`;
            const revisionRef = doc(originalReceiptRef, "revisions", revisionId);

            const structuredDiff = diff(editingReceipt, updatedReceipt);
            const diffSummary = Object.keys(structuredDiff).join(', ');
            
            // 1. Write revision snapshot
            batch.set(revisionRef, {
                version: nextVersion,
                editedAt: serverTimestamp(),
                editedByUid: appUser.uid,
                editedByEmail: appUser.email,
                reason,
                diffSummary,
                diff: structuredDiff,
                snapshot: editingReceipt, // The full old receipt data
            });

            // 2. Overwrite original receipt
            batch.update(originalReceiptRef, {
                ...updatedReceipt,
                isEdited: true,
                editVersion: nextVersion,
                editedAt: serverTimestamp(),
                editedByUid: appUser.uid,
                editedByEmail: appUser.email,
                editReason: reason,
                lastDiffSummary: diffSummary,
            });

            await batch.commit();
            await applyAnalyticsDelta(activeStore.id, editingReceipt, updatedReceipt as ReceiptType);

            // 3. Log activity
            await writeActivityLog({
                action: "RECEIPT_EDITED",
                storeId: activeStore.id,
                sessionId: editingReceipt.sessionId,
                user: appUser,
                meta: { 
                    receiptId: editingReceipt.id, 
                    receiptNumber: editingReceipt.receiptNumber,
                    editVersion: nextVersion,
                    diffSummary,
                }
            });

            toast({ title: "Receipt Updated", description: "The correction has been saved and audited." });
            setEditingReceipt(null);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Correction Failed', description: error.message });
            throw error;
        }
    }


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

    const handleDeleteReceipt = async (receipt: ReceiptType) => {
        if (!appUser || !activeStore || appUser.role !== 'admin') {
            toast({ variant: 'destructive', title: "Permission Denied" });
            return;
        }

        const confirmed = await confirm({
            title: `Delete Receipt ${receipt.receiptNumber}?`,
            description: "This action is irreversible and will permanently delete the receipt. This cannot be undone.",
            confirmText: "Yes, Delete Permanently",
            destructive: true,
        });

        if (!confirmed) return;

        setIsDeleting(receipt.id);
        try {
            await deleteDoc(doc(db, "stores", activeStore.id, "receipts", receipt.id));
            await applyAnalyticsDelta(activeStore.id, receipt, null);

            await writeActivityLog({
                action: "RECEIPT_DELETED",
                storeId: activeStore.id,
                sessionId: receipt.sessionId,
                user: appUser,
                meta: { receiptNumber: receipt.receiptNumber, amount: receipt.total }
            });
            toast({ title: "Receipt Deleted", description: `Receipt ${receipt.receiptNumber} has been removed.` });
            if (selectedReceiptId === receipt.id) {
                setSelectedReceiptId(null);
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Delete Failed", description: error.message });
        } finally {
            setIsDeleting(null);
        }
    };

    const handleExport = async () => {
        if (!activeStore) return;
        setIsExporting(true);
    
        // Sheet 1: Summary Data
        const summaryData = filteredReceipts.map(r => {
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
        filteredReceipts.forEach(r => {
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
    
        setIsExporting(false);
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
            <PageHeader title="Receipts" description="Browse, preview, and reprint past receipts.">
                <div className="flex items-center gap-2">
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
                                        {appUser?.role === 'admin' && <TableHead className="text-right">Actions</TableHead>}
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
                                            <TableCell className="font-bold py-2">₱{r.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                            {appUser?.role === 'admin' && (
                                                <TableCell className="text-right py-2">
                                                    <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleEditReceipt(r); }} className="mr-2">
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="destructive" size="sm" onClick={(e) => { e.stopPropagation(); handleDeleteReceipt(r); }} disabled={isDeleting === r.id}>
                                                        {isDeleting === r.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4"/>}
                                                    </Button>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))}
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

            {/* This div is only for printing */}
            <div className="hidden print-block">
                {selectedReceiptData && <ReceiptView data={selectedReceiptData} paymentMethods={paymentMethods} />}
            </div>
            {ConfirmDialog}
        </RoleGuard>
    )
}
