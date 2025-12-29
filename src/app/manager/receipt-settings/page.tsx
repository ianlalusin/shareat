
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
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { cn } from "@/lib/utils";

export default function ReceiptSettingsPage() {
    const { appUser } = useAuthContext();
    const { activeStore, loading } = useStoreContext();
    
    // State for the bottom panel (recent receipts)
    const [selectedRecentReceipt, setSelectedRecentReceipt] = useState<ReceiptData | null>(null);

    // State and form for the top panel (live settings preview)
    const form = useForm({
        resolver: zodResolver(receiptSettingsSchema),
        defaultValues: {
            businessName: activeStore?.name || "",
            branchName: activeStore?.name || "",
            address: activeStore?.address || "",
            contact: activeStore?.contactNumber || "",
            vatType: "NON_VAT",
            showCashierName: true,
            showServerName: true,
            showTableOrCustomer: true,
            showItemNotes: true,
            showDiscountBreakdown: true,
            showChargeBreakdown: true,
            paperWidth: "80mm",
        }
    });

    const watchedSettings = form.watch();

    const canEditReceiptSettings = appUser?.role === 'admin' || appUser?.role === 'manager';

    useEffect(() => {
        if (!activeStore) return;
        const settingsRef = doc(db, `stores/${activeStore.id}/receiptSettings`, "main");
        const unsubscribe = onSnapshot(settingsRef, (doc) => {
            if (doc.exists()) {
                form.reset(doc.data());
            }
        });
        return () => unsubscribe();
    }, [activeStore, form]);

    const handlePrint = (data: ReceiptData | null) => {
        if (data) {
            setSelectedRecentReceipt(data);
            setTimeout(() => window.print(), 100);
        }
    };
    
    const livePreviewData = useMemo(() => ({
        session: {
            id: 'PREVIEW',
            tableNumber: '12',
            sessionMode: 'package_dinein' as const,
            paymentSummary: { subtotal: 850, lineDiscountsTotal: 50, billDiscountAmount: 0, adjustmentsTotal: 10, grandTotal: 810, totalPaid: 900, change: 90 },
            closedAt: new Date(),
            startedByUid: 'cashier123',
        },
        billables: [
            { itemName: 'Sample Package', qty: 2, unitPrice: 425, isFree: false, lineDiscountType: 'fixed' as const, lineDiscountValue: 25 },
            { itemName: 'Extra Fries', qty: 1, unitPrice: 100, isFree: false, lineDiscountType: 'fixed' as const, lineDiscountValue: 0 },
        ],
        payments: [{ methodId: 'Cash', amount: 900 }],
        settings: watchedSettings,
    } as ReceiptData), [watchedSettings]);

    if (loading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>
    }

    if (!activeStore) {
        return (
            <Card className="w-full max-w-md mx-auto text-center">
                <CardHeader>
                    <CardTitle>No Store Selected</CardTitle>
                    <CardDescription>Please select a store from the dropdown in the header to manage its receipt settings.</CardDescription>
                </CardHeader>
            </Card>
        )
    }

    return (
        <RoleGuard allow={["admin", "manager", "cashier"]}>
            <PageHeader title="Receipt Center" description={`Manage receipt templates and browse recent transactions for ${activeStore.name}`} />
            
            {canEditReceiptSettings && (
                 <Accordion type="single" collapsible className="w-full" defaultValue="settings">
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
                                                <Button onClick={() => handlePrint(livePreviewData)} className="no-print">
                                                    <Printer className="mr-2"/> Print Preview
                                                </Button>
                                            </CardHeader>
                                            <CardContent className="receipt-print-container bg-gray-100 dark:bg-gray-800 p-2 rounded-b-lg">
                                                <ReceiptView data={livePreviewData} />
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                </Accordion>
            )}


            <Separator className="my-8" />

            <Card>
                 <CardHeader>
                    <CardTitle>Recent Transactions</CardTitle>
                    <CardDescription>Select a transaction to view and reprint its receipt.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className={cn("grid grid-cols-1 gap-6 items-start", canEditReceiptSettings ? "lg:grid-cols-2" : "lg:grid-cols-[1fr,1fr]")}>
                        <RecentReceiptsList store={activeStore} onSelectReceipt={setSelectedRecentReceipt}/>
                        <div className="space-y-4">
                             <Card className="sticky top-20">
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle>Selected Receipt</CardTitle>
                                    <Button onClick={() => handlePrint(selectedRecentReceipt)} disabled={!selectedRecentReceipt} className="no-print">
                                        <Printer className="mr-2"/> Print
                                    </Button>
                                </CardHeader>
                                <CardContent className="receipt-print-container bg-gray-100 dark:bg-gray-800 p-2 rounded-b-lg">
                                {selectedRecentReceipt ? (
                                        <ReceiptView data={selectedRecentReceipt} />
                                ) : (
                                    <div className="flex items-center justify-center h-96 text-muted-foreground">
                                        <p>Select a recent receipt to preview.</p>
                                    </div>
                                )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </RoleGuard>
    );
}
