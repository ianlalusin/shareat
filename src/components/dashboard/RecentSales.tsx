
"use client";

import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { ReceiptView } from "../receipt/receipt-view";
import type { ReceiptData } from "@/lib/types";
import { Button } from "../ui/button";
import { Printer } from "lucide-react";
import { doc, getDoc, collection, getDocs, query, orderBy, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { usePrint } from "@/hooks/use-print";
import { useAuthContext } from "@/context/auth-context";
import { format } from "date-fns";

export type Sale = {
    id: string;
    receiptNumber?: string;
    customerName?: string | null;
    tableNumber?: string | null;
    sessionMode?: 'package_dinein' | 'alacarte';
    total: number;
    createdAtClientMs: number;
};

interface RecentSalesProps {
    sales: Sale[];
    storeId: string;
    isLoading: boolean;
}


export function RecentSales({ sales, storeId, isLoading }: RecentSalesProps) {
    const { appUser } = useAuthContext();
    const [selectedReceipt, setSelectedReceipt] = useState<ReceiptData | null>(null);
    const { printReceipt, isPrinting } = usePrint({ receiptData: selectedReceipt, storeId, sessionId: selectedReceipt?.session?.id, appUser });
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const handleSelectReceipt = async (sale: Sale) => {
        const [settingsSnap, receiptSnap] = await Promise.all([
            getDoc(doc(db, "stores", storeId, "receiptSettings", "main")),
            getDoc(doc(db, "stores", storeId, "receipts", sale.id))
        ]);

        if (!receiptSnap.exists()) return;
        
        const receiptDocData = receiptSnap.data({ serverTimestamps: "estimate" }) as any;
        const settingsData = settingsSnap.exists() ? settingsSnap.data() as any : {};
        
        // For preview, we can get most data from the receipt snapshot itself
        const sessionDataForPreview = {
            id: receiptDocData.sessionId,
            tableNumber: receiptDocData.tableNumber,
            customerName: receiptDocData.customerName,
            sessionMode: receiptDocData.sessionMode,
            paymentSummary: receiptDocData.analytics,
            closedAt: receiptDocData.createdAt,
            startedByUid: "N/A", // This is not available in receipt, but can be added if needed
        };
        
        setSelectedReceipt({
            session: sessionDataForPreview as any,
            lines: receiptDocData.lines || [],
            payments: Object.entries(receiptDocData.analytics?.mop || {}).map(([key, value]) => ({ methodId: key, amount: value as number})),
            settings: settingsData,
            receiptCreatedAt: receiptDocData.createdAt,
            createdByUsername: receiptDocData.createdByUsername,
            receiptNumber: receiptDocData.receiptNumber,
        });
        setIsDrawerOpen(true);
    };


    if (isLoading) {
        return (
            <div className="space-y-8">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center">
                        <Skeleton className="h-9 w-9 rounded-full" />
                        <div className="ml-4 space-y-1">
                            <Skeleton className="h-4 w-[150px]" />
                            <Skeleton className="h-4 w-[100px]" />
                        </div>
                        <Skeleton className="ml-auto h-4 w-[50px]" />
                    </div>
                ))}
            </div>
        );
    }
    
    if (sales.length === 0) {
        return <p className="text-center text-muted-foreground py-10">No sales recorded today.</p>
    }

    return (
        <>
            <div className="space-y-4">
                {sales.map((sale) => {
                    const primaryId = sale.receiptNumber ?? (sale.sessionMode === 'alacarte' ? sale.customerName : `Table ${sale.tableNumber}`);
                    return (
                        <button key={sale.id} onClick={() => handleSelectReceipt(sale)} className="flex items-center w-full text-left hover:bg-muted/50 p-2 rounded-md">
                            <Avatar className="h-9 w-9">
                                <AvatarFallback>{primaryId?.charAt(0) || 'R'}</AvatarFallback>
                            </Avatar>
                            <div className="ml-4 space-y-1">
                                <p className="text-sm font-medium leading-none">{primaryId}</p>
                                <p className="text-sm text-muted-foreground">{format(new Date(sale.createdAtClientMs), "p")}</p>
                            </div>
                            <div className="ml-auto font-medium">₱{sale.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </button>
                    )
                })}
            </div>
            
            <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
                <DrawerContent>
                    <div className="mx-auto w-full max-w-sm">
                        <DrawerHeader>
                            <DrawerTitle>Receipt Preview</DrawerTitle>
                            <DrawerDescription>
                                <Button onClick={printReceipt} disabled={isPrinting} className="w-full no-print mt-2">
                                    {isPrinting ? "Printing..." : <><Printer className="mr-2"/> Reprint Receipt</>}
                                </Button>
                            </DrawerDescription>
                        </DrawerHeader>
                        <div className="p-4 pb-0">
                            <div id="print-receipt-area" className="max-h-[60vh] overflow-y-auto">
                                {selectedReceipt && <ReceiptView data={selectedReceipt} />}
                            </div>
                        </div>
                    </div>
                </DrawerContent>
            </Drawer>
        </>
    );
}

    