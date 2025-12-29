
"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { collection, query, orderBy, limit, onSnapshot, Timestamp, getDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { Store } from "@/lib/types";
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
    total: number;
    totalPaid: number;
    change: number;
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
                const [sessionSnap, billablesSnap, paymentsSnap, settingsSnap, receiptSnap] = await Promise.all([
                    getDoc(doc(db, "stores", store.id, "sessions", selectedSessionId)),
                    getDocs(query(collection(db, "stores", store.id, "sessions", selectedSessionId, "billables"), orderBy("createdAt", "asc"))),
                    getDocs(query(collection(db, "stores", store.id, "sessions", selectedSessionId, "payments"), orderBy("createdAt", "asc"))),
                    getDoc(doc(db, "stores", store.id, "receiptSettings", "main")),
                    getDoc(doc(db, "stores", store.id, "receipts", selectedSessionId))
                ]);
                
                if (!sessionSnap.exists()) throw new Error("Session not found.");
                
                const settingsData = settingsSnap.exists() ? settingsSnap.data() as any : {};
                const receiptCreatedAt = receiptSnap.exists() ? receiptSnap.data({ serverTimestamps: "estimate" }).createdAt : null;

                onSelectReceipt({
                    session: sessionSnap.data() as any,
                    billables: billablesSnap.docs.map(d => d.data()) as any[],
                    payments: paymentsSnap.docs.map(d => d.data()) as any[],
                    settings: settingsData,
                    receiptCreatedAt: receiptCreatedAt,
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
                                <TableHead>Time Closed</TableHead>
                                <TableHead>Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {receipts.length > 0 ? (
                                receipts.map(receipt => {
                                    const identifier = receipt.sessionMode === 'alacarte' 
                                        ? receipt.customerName || 'Ala Carte'
                                        : `Table ${receipt.tableNumber ?? '—'}`;
                                    
                                    const d = toJsDate(receipt.createdAt);
                                    const timeClosedLabel = d ? format(d, 'p') : "—";

                                    return (
                                        <TableRow 
                                            key={receipt.id} 
                                            onClick={() => handleSelectSession(receipt.sessionId)}
                                            className="cursor-pointer"
                                            data-state={selectedSessionId === receipt.sessionId ? 'selected' : undefined}
                                        >
                                            <TableCell className="font-medium">{identifier}</TableCell>
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
