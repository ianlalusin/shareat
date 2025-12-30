

"use client";

import { useState, useEffect, useMemo } from "react";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { ReceiptSettings, receiptSettingsSchema } from "@/components/manager/store-settings/receipt-settings";
import { useStoreContext } from "@/context/store-context";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RecentReceiptsList } from "@/components/manager/receipts/RecentReceiptsList";
import { Separator } from "@/components/ui/separator";
import { ReceiptView, type ReceiptData } from "@/components/receipt/receipt-view";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { doc, onSnapshot, setDoc, serverTimestamp, updateDoc, increment } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function getUsername(appUser: any) {
  return (appUser?.displayName?.trim())
    || (appUser?.name?.trim())
    || (appUser?.email ? String(appUser.email).split("@")[0] : "")
    || (appUser?.uid ? String(appUser.uid).slice(0,6) : "unknown");
}

export default function ReceiptSettingsPage() {
    const { appUser } = useAuthContext();
    const { activeStore, loading } = useStoreContext();
    const { toast } = useToast();
    
    const [selectedRecentReceipt, setSelectedRecentReceipt] = useState<ReceiptData | null>(null);
    const [isPrinting, setIsPrinting] = useState(false);
    const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm" | "A4">("80mm");

    const form = useForm({
        resolver: zodResolver(receiptSettingsSchema),
        defaultValues: {
            businessName: activeStore?.name || "",
            branchName: activeStore?.name || "",
            address: activeStore?.address || "",
            contact: activeStore?.contactNumber || "",
            tin: activeStore?.tin || "",
            logoUrl: activeStore?.logoUrl || null,
            vatType: activeStore?.vatType || "NON_VAT",
            showCashierName: true,
            showTableOrCustomer: true,
            showItemNotes: true,
            showDiscountBreakdown: true,
            showChargeBreakdown: true,
            paperWidth: "80mm",
            receiptNoFormat: "",
            autoPrintAfterPayment: false,
        }
    });

    const watchedSettings = form.watch();

    const storageKey = useMemo(
        () => `receiptPaperWidth:${activeStore?.id ?? "nostore"}:${appUser?.uid ?? "nouser"}`,
        [activeStore?.id, appUser?.uid]
    );

    useEffect(() => {
        const storedWidth = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
        if (storedWidth === "58mm" || storedWidth === "80mm" || storedWidth === "A4") {
            setPaperWidth(storedWidth);
        }
    }, [storageKey]);

    useEffect(() => {
        if (!activeStore) return;

        form.setValue("businessName", activeStore.name);
        form.setValue("branchName", activeStore.name);
        form.setValue("address", activeStore.address);
        form.setValue("contact", activeStore.contactNumber || "");
        form.setValue("tin", activeStore.tin || "");
        form.setValue("logoUrl", activeStore.logoUrl || null);
        form.setValue("vatType", activeStore.vatType || "NON_VAT");

        const settingsRef = doc(db, `stores/${activeStore.id}/receiptSettings`, "main");
        const unsubscribe = onSnapshot(settingsRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                form.reset({
                    ...data,
                    businessName: activeStore.name,
                    branchName: activeStore.name,
                    address: activeStore.address,
                    contact: activeStore.contactNumber || "",
                    tin: activeStore.tin || "",
                    logoUrl: activeStore.logoUrl || null,
                    vatType: activeStore.vatType || "NON_VAT",
                    receiptNoFormat: data.receiptNoFormat || "",
                    autoPrintAfterPayment: data.autoPrintAfterPayment || false,
                });
                setPaperWidth(data.paperWidth || "80mm");
            }
        });
        return () => unsubscribe();
    }, [activeStore, form]);

    const handlePrint = async (receiptId: string | undefined) => {
        if (!receiptId || !activeStore || !appUser) return;
        if (isPrinting) return;
    
        setIsPrinting(true);
    
        window.requestAnimationFrame(async () => {
            window.print();
    
            if (receiptId !== "PREVIEW") {
                try {
                    const receiptRef = doc(db, `stores/${activeStore.id}/receipts`, receiptId);
                    await updateDoc(receiptRef, {
                        printedCount: increment(1),
                        lastPrintedAt: serverTimestamp(),
                        lastPrintedByUid: appUser.uid,
                        lastPrintedByUsername: getUsername(appUser),
                    });
                } catch (e) {
                    console.warn("Print audit tracking failed:", e);
                }
            }
    
            setIsPrinting(false);
        });
    };

    const handlePaperWidthChange = (value: "58mm" | "80mm" | "A4") => {
        setPaperWidth(value);
        localStorage.setItem(storageKey, value);
        form.setValue("paperWidth", value);
    };
    
    const livePreviewData = useMemo(() => ({
        session: {
            id: 'PREVIEW',
            tableNumber: '12',
            sessionMode: 'package_dinein' as const,
            paymentSummary: { subtotal: 850, lineDiscountsTotal: 50, billDiscountAmount: 0, adjustmentsTotal: 10, grandTotal: 810, totalPaid: 900, change: 90, printedCount: 0 },
            closedAt: new Date(),
            startedByUid: 'cashier123',
        },
        billables: [
            { itemName: 'Sample Package', qty: 2, unitPrice: 425, isFree: false, lineDiscountType: 'fixed' as const, lineDiscountValue: 25 },
            { itemName: 'Extra Fries', qty: 1, unitPrice: 100, isFree: false, lineDiscountType: 'fixed' as const, lineDiscountValue: 0 },
        ],
        payments: [{ methodId: 'Cash', amount: 900 }],
        settings: watchedSettings,
    } as unknown as ReceiptData), [watchedSettings]);

    if (loading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>
    }

    if (!activeStore) {
        return (
             <RoleGuard allow={["admin", "manager"]}>
                <Card className="w-full max-w-md mx-auto text-center">
                    <CardHeader>
                        <CardTitle>No Store Selected</CardTitle>
                        <CardDescription>Please select a store from the dropdown in the header to manage its receipt settings.</CardDescription>
                    </CardHeader>
                </Card>
            </RoleGuard>
        )
    }

    const printedCount = selectedRecentReceipt?.session?.paymentSummary?.printedCount || 0;
    return (
        <RoleGuard allow={["admin", "manager"]}>
            <PageHeader title="Receipt Center" description={`Manage receipt templates and browse recent transactions for ${activeStore.name}`} />
            
             <Accordion type="single" collapsible className="w-full no-print" defaultValue="settings">
                <AccordionItem value="settings">
                    <Card>
                        <AccordionTrigger className="p-6">
                            <div className="flex justify-between w-full pr-4">
                                <CardTitle>Receipt Template Settings</CardTitle>
                                <CardDescription>Click to expand and edit your receipt template.</CardDescription>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 border-t">
                                <div>
                                    <ReceiptSettings store={activeStore} form={form} />
                                </div>
                                <div className="space-y-4">
                                    <Card className="sticky top-20">
                                        <CardHeader className="flex flex-row items-center justify-between">
                                            <CardTitle>Live Preview</CardTitle>
                                            <div className="flex items-center gap-2">
                                                <Select value={paperWidth} onValueChange={handlePaperWidthChange}>
                                                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="58mm">58mm</SelectItem>
                                                        <SelectItem value="80mm">80mm</SelectItem>
                                                        <SelectItem value="A4">A4</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <Button onClick={() => handlePrint('PREVIEW')} className="no-print" disabled={isPrinting}>
                                                    {isPrinting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Printing...</>) : (<><Printer className="mr-2"/> Print Preview</>)}
                                                </Button>
                                            </div>
                                        </CardHeader>
                                        <CardContent id="print-receipt-area-live" className="bg-gray-100 dark:bg-gray-800 p-2 rounded-b-lg">
                                            <ReceiptView data={livePreviewData} forcePaperWidth={paperWidth} />
                                        </CardContent>
                                    </Card>
                                </div>
                            </div>
                        </AccordionContent>
                    </Card>
                </AccordionItem>
            </Accordion>


            <Separator className="my-8 no-print" />

            <div className="grid grid-cols-1 gap-6 items-start no-print lg:grid-cols-2">
                <RecentReceiptsList store={activeStore} onSelectReceipt={setSelectedRecentReceipt}/>
                <div className="space-y-4">
                     <Card className="sticky top-20">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Selected Receipt</CardTitle>
                            <div className="flex items-center gap-2">
                               <Select value={paperWidth} onValueChange={handlePaperWidthChange}>
                                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="58mm">58mm</SelectItem>
                                        <SelectItem value="80mm">80mm</SelectItem>
                                        <SelectItem value="A4">A4</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button onClick={() => handlePrint(selectedRecentReceipt?.session.id)} disabled={!selectedRecentReceipt || isPrinting} className="no-print w-28">
                                    {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2"/>}
                                    {printedCount > 0 ? 'Reprint' : 'Print'}
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent id="print-receipt-area" className="bg-gray-100 dark:bg-gray-800 p-2 rounded-b-lg">
                        {selectedRecentReceipt ? (
                                <ReceiptView data={selectedRecentReceipt} forcePaperWidth={paperWidth} />
                        ) : (
                            <div className="flex items-center justify-center h-96 text-muted-foreground">
                                <p>Select a recent receipt to preview.</p>
                            </div>
                        )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </RoleGuard>
    );
}
