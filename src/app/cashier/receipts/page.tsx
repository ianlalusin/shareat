
"use client";

import { useState, useEffect, useMemo } from "react";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { useStoreContext } from "@/context/store-context";
import { Loader2, Printer, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RecentReceiptsList } from "@/components/manager/receipts/RecentReceiptsList";
import { ReceiptView, type ReceiptData } from "@/components/receipt/receipt-view";
import { Button } from "@/components/ui/button";
import { doc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function getUsername(appUser: any) {
  return (appUser?.displayName?.trim())
    || (appUser?.name?.trim())
    || (appUser?.email ? String(appUser.email).split("@")[0] : "")
    || (appUser?.uid ? String(appUser.uid).slice(0,6) : "unknown");
}

export default function CashierReceiptsPage() {
    const { appUser } = useAuthContext();
    const { activeStore, loading } = useStoreContext();
    const { toast } = useToast();
    
    const [selectedRecentReceipt, setSelectedRecentReceipt] = useState<ReceiptData | null>(null);
    const [isPrinting, setIsPrinting] = useState(false);
    const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm" | "A4">("80mm");

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

    const handlePrint = async (data: ReceiptData | null) => {
        if (!data || !activeStore) return;
        if (isPrinting) return;

        setIsPrinting(true);
        try {
            setSelectedRecentReceipt(data);

            if (data.session?.id && data.session.id !== "PREVIEW" && appUser?.uid) {
                try {
                    const receiptRef = doc(db, `stores/${activeStore.id}/receipts`, data.session.id);
                    await updateDoc(receiptRef, {
                        printedCount: increment(1),
                        lastPrintedAt: serverTimestamp(),
                        lastPrintedByUid: appUser.uid,
                        lastPrintedByUsername: getUsername(appUser),
                    });
                } catch (e) {
                    console.warn("Print tracking failed", e);
                    toast({ variant: "destructive", title: "Print tracking failed", description: "Printing will continue, but audit fields were not saved." });
                }
            }

            setTimeout(() => window.print(), 100);
        } finally {
            setIsPrinting(false);
        }
    };
    
    const handlePaperWidthChange = (value: "58mm" | "80mm" | "A4") => {
        setPaperWidth(value);
        localStorage.setItem(storageKey, value);
    };

    if (loading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>
    }

    if (!activeStore) {
        return (
            <Card className="w-full max-w-md mx-auto text-center">
                <CardHeader>
                    <CardTitle>No Store Selected</CardTitle>
                    <CardDescription>Please select a store from the dropdown in the header to view receipts.</CardDescription>
                </CardHeader>
            </Card>
        )
    }

    return (
        <RoleGuard allow={["admin", "manager", "cashier"]}>
            <PageHeader title="Receipts" description={`Browse and reprint recent transactions for ${activeStore.name}`} />
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start no-print">
                <RecentReceiptsList store={activeStore} onSelectReceipt={setSelectedRecentReceipt}/>
                <div className="space-y-4">
                     <Card className="sticky top-20">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Receipt Preview</CardTitle>
                            <div className="flex items-center gap-2">
                               <Select value={paperWidth} onValueChange={handlePaperWidthChange}>
                                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="58mm">58mm</SelectItem>
                                        <SelectItem value="80mm">80mm</SelectItem>
                                        <SelectItem value="A4">A4</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button onClick={() => handlePrint(selectedRecentReceipt)} disabled={!selectedRecentReceipt || isPrinting} className="no-print">
                                    {isPrinting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Printing...</>) : (<><Printer className="mr-2"/> Print</>)}
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="receipt-print-container bg-gray-100 dark:bg-gray-800 p-2 rounded-b-lg">
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
             <div className="hidden print-block">
                {selectedRecentReceipt && <ReceiptView data={selectedRecentReceipt} forcePaperWidth={paperWidth} />}
             </div>
        </RoleGuard>
    );
}
