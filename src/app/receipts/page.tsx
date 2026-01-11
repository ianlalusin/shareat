
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
import { Loader2, Printer, Search, Settings, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useStoreContext } from "@/context/store-context";
import { db } from "@/lib/firebase/client";
import { collection, query, orderBy, onSnapshot, doc, getDoc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { format } from "date-fns";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { ReceiptView, type ReceiptData } from "@/components/receipt/receipt-view";
import { ReceiptSettings as ReceiptTemplateSettings, receiptSettingsSchema } from "@/components/receipts/ReceiptTemplateSettings";
import { useAuthContext } from "@/context/auth-context";
import { toJsDate } from "@/lib/utils/date";
import type { Receipt as ReceiptType, ModeOfPayment, Store } from "@/lib/types";
import * as XLSX from "xlsx";

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
        const q = query(collection(db, "stores", activeStore.id, "receipts"), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setReceipts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ReceiptType)));
            setIsLoadingReceipts(false);
        }, (error) => {
            console.error("Error fetching receipts:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch receipts.' });
            setIsLoadingReceipts(false);
        });

        return () => unsubscribe();
    }, [activeStore, toast]);

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
        const dataToExport = filteredReceipts.map(r => ({
            "Receipt Number": r.receiptNumber || 'N/A',
            "Date": r.createdAt ? format(toJsDate(r.createdAt)!, 'MM/dd/yy p') : 'N/A',
            "Customer/Table": r.sessionMode === 'alacarte' ? r.customerName || 'Ala Carte' : `Table ${r.tableNumber || 'N/A'}`,
            "Cashier": r.createdByUsername || 'N/A',
            "Total": r.total
        }));
        
        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Receipts");
        
        XLSX.writeFile(workbook, "receipts_export.xlsx");
        toast({ title: "Export Started", description: "Your download will begin shortly." });
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
                <Button variant="outline" onClick={handleExport} disabled={filteredReceipts.length === 0}><Download className="mr-2"/> Export</Button>
                <Button onClick={() => setIsSettingsOpen(true)}><Settings className="mr-2"/> Receipt Settings</Button>
            </PageHeader>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Recent Transactions</CardTitle>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search by Receipt #, Table, Customer..." className="pl-8" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isLoadingReceipts ? <Loader2 className="mx-auto animate-spin" /> : (
                            <Table>
                                <TableHeader><TableRow><TableHead>Identifier</TableHead><TableHead>Date/Time</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {filteredReceipts.map(r => (
                                        <TableRow 
                                            key={r.id} 
                                            onClick={() => handleSelectReceipt(r.id)}
                                            className={cn("cursor-pointer", selectedReceiptId === r.id && "bg-muted")}
                                        >
                                            <TableCell className="font-medium">
                                                <div>{r.receiptNumber || `Tbl ${r.tableNumber}` || r.customerName}</div>
                                                <div className="text-xs text-muted-foreground">{r.createdByUsername || 'N/A'}</div>
                                            </TableCell>
                                            <TableCell>{format(toJsDate(r.createdAt)!, 'MM/dd/yy p')}</TableCell>
                                            <TableCell className="text-right">₱{r.total.toFixed(2)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
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
