

"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { collection, query, orderBy, limit, onSnapshot, Timestamp, getDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { Store, SessionBillLine } from "@/lib/types";
import { Loader2 } from "lucide-react";
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";
import type { ReceiptData } from "@/components/receipt/receipt-view";
import { toJsDate } from "@/lib/utils/date";

type ReceiptRow = {
    id: string;
    sessionId: string;
    tableNumber: string | null;
    customerName: string | null;
    sessionMode: 'package_dinein' | 'alacarte';
    createdAt: Timestamp | Date | { seconds: number; nanoseconds: number };
    createdAtClientMs: number;
    createdByUsername?: string;
    createdByUid: string;
    total: number;
    totalPaid: number;
    change: number;
    receiptNumber?: string;
};


interface RecentReceiptsListProps {
    store: Store;
    onSelectReceipt: (data: ReceiptData | null) => void;
}


export function RecentReceiptsList({ store, onSelectReceipt }: RecentReceiptsListProps) {
    const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

    useEffect(() => {
        if (!store) return;
        
        setIsLoading(true);
        const receiptsRef = collection(db, "stores", store.id, "receipts");
        const q = query(
            receiptsRef, 
            orderBy("createdAt", "desc"), 
            limit(20)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            setReceipts(snapshot.docs.map(d => {
              const data = d.data({ serverTimestamps: "estimate" }) as any;
              return {
                id: d.id,
                ...data,
              } as ReceiptRow;
            }));
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching recent receipts:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [store]);
    
    useEffect(() => {
        const fetchReceiptData = async () => {
            if (!selectedSessionId || !store) {
                onSelectReceipt(null);
                return;
            }

            try {
                const receiptSnap = await getDoc(doc(db, "stores", store.id, "receipts", selectedSessionId));
                
                if (!receiptSnap.exists()) throw new Error("Receipt not found.");
                
                const receiptDocData = receiptSnap.data({ serverTimestamps: "estimate" }) as any;
                
                // For preview, we can get most data from the receipt snapshot itself
                const sessionDataForPreview = {
                    id: receiptDocData.sessionId,
                    tableNumber: receiptDocData.tableNumber,
                    customerName: receiptDocData.customerName,
                    sessionMode: receiptDocData.sessionMode,
                    paymentSummary: receiptDocData.analytics,
                    closedAt: receiptDocData.createdAt,
                    startedByUid: "N/A",
                };

                const settingsSnap = await getDoc(doc(db, "stores", store.id, "receiptSettings", "main"));
                const settingsData = settingsSnap.exists() ? settingsSnap.data() as any : {};
                
                onSelectReceipt({
                    session: sessionDataForPreview as any,
                    lines: receiptDocData.lines || [],
                    payments: Object.entries(receiptDocData.analytics?.mop || {}).map(([key, value]) => ({ methodId: key, amount: value as number})),
                    settings: settingsData,
                    receiptCreatedAt: receiptDocData.createdAt,
                    createdByUsername: receiptDocData.createdByUsername,
                    receiptNumber: receiptDocData.receiptNumber,
                    analytics: receiptDocData.analytics,
                });

            } catch (err: any) {
                console.error("Failed to fetch receipt data:", err);
                onSelectReceipt(null);
            }
        };

        fetchReceiptData();
    }, [selectedSessionId, store, onSelectReceipt]);


    const handleSelectSession = (sessionId: string) => {
        setSelectedSessionId(sessionId);
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Recent Receipts</CardTitle>
                <CardDescription>A list of the last 20 completed transactions. Select one to preview.</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Identifier</TableHead>
                                <TableHead>Cashier</TableHead>
                                <TableHead>Time Closed</TableHead>
                                <TableHead>Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {receipts.length > 0 ? (
                                receipts.map(receipt => {
                                    const primaryIdentifier = receipt.receiptNumber ?? (receipt.sessionMode === 'alacarte' ? receipt.customerName : `Table ${receipt.tableNumber ?? '—'}`);
                                    const secondaryIdentifier = receipt.receiptNumber ? (receipt.sessionMode === 'alacarte' ? receipt.customerName : `Table ${receipt.tableNumber ?? '—'}`) : null;
                                    
                                    const d = toJsDate(receipt.createdAt) ?? (receipt.createdAtClientMs ? new Date(receipt.createdAtClientMs) : null);
                                    const timeClosedLabel = d ? format(d, 'MM/dd/yy HH:mm') : "—";
                                    const cashierName = receipt.createdByUsername ?? receipt.createdByUid.substring(0, 6);

                                    return (
                                        <TableRow 
                                            key={receipt.id} 
                                            onClick={() => handleSelectSession(receipt.sessionId)}
                                            className="cursor-pointer"
                                            data-state={selectedSessionId === receipt.sessionId ? 'selected' : undefined}
                                        >
                                            <TableCell className="font-medium">
                                                <div>{primaryIdentifier}</div>
                                                {secondaryIdentifier && <div className="text-xs text-muted-foreground">{secondaryIdentifier}</div>}
                                            </TableCell>
                                            <TableCell>{cashierName}</TableCell>
                                            <TableCell>{timeClosedLabel}</TableCell>
                                            <TableCell>₱{(receipt.total || 0).toFixed(2)}</TableCell>
                                        </TableRow>
                                    );
                                })
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                                        No receipts found.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
