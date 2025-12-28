
"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { collection, query, where, orderBy, limit, onSnapshot, Timestamp, getDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Store } from "@/app/admin/stores/page";
import { Loader2 } from "lucide-react";
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";
import type { ReceiptData } from "@/components/receipt/receipt-view";

type PastSession = {
    id: string;
    tableNumber: string;
    customer?: { name?: string };
    sessionMode: 'package_dinein' | 'alacarte';
    closedAt: Timestamp | Date | { seconds: number; nanoseconds: number };
    paymentSummary: {
        grandTotal: number;
    };
};

interface RecentReceiptsListProps {
    store: Store;
    onSelectReceipt: (data: ReceiptData | null) => void;
}

export function RecentReceiptsList({ store, onSelectReceipt }: RecentReceiptsListProps) {
    const [sessions, setSessions] = useState<PastSession[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

    useEffect(() => {
        if (!store) return;
        
        setIsLoading(true);
        const sessionsRef = collection(db, "stores", store.id, "sessions");
        const q = query(
            sessionsRef, 
            where("status", "==", "closed"), 
            orderBy("closedAt", "desc"), 
            limit(20)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            setSessions(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()} as PastSession)));
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching recent sessions:", error);
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
                const [sessionSnap, billablesSnap, paymentsSnap, settingsSnap] = await Promise.all([
                    getDoc(doc(db, "stores", store.id, "sessions", selectedSessionId)),
                    getDocs(query(collection(db, "stores", store.id, "sessions", selectedSessionId, "billables"), orderBy("createdAt", "asc"))),
                    getDocs(query(collection(db, "stores", store.id, "sessions", selectedSessionId, "payments"), orderBy("createdAt", "asc"))),
                    getDoc(doc(db, "stores", store.id, "receiptSettings", "main"))
                ]);
                
                if (!sessionSnap.exists()) throw new Error("Session not found.");
                
                const settingsData = settingsSnap.exists() ? settingsSnap.data() as any : {};
                onSelectReceipt({
                    session: sessionSnap.data() as any,
                    billables: billablesSnap.docs.map(d => d.data()) as any[],
                    payments: paymentsSnap.docs.map(d => d.data()) as any[],
                    settings: settingsData,
                });

            } catch (err: any) {
                console.error("Failed to fetch receipt data:", err);
                onSelectReceipt(null);
            }
        };

        fetchReceiptData();
    }, [selectedSessionId, store, onSelectReceipt]);


    const getFormattedDate = (date: PastSession['closedAt']) => {
        if (!date) return 'N/A';

        if (typeof (date as Timestamp).toDate === 'function') {
            return format((date as Timestamp).toDate(), 'p');
        }
        
        if (typeof date === 'object' && 'seconds' in date && 'nanoseconds' in date) {
            const jsDate = new Date(date.seconds * 1000 + date.nanoseconds / 1000000);
            return format(jsDate, 'p');
        }
        
        if (date instanceof Date) {
            return format(date, 'p');
        }

        return 'Invalid Date';
    };
    
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
                            {sessions.length > 0 ? (
                                sessions.map(session => {
                                    const identifier = session.sessionMode === 'alacarte' 
                                        ? session.customer?.name || 'Ala Carte'
                                        : `Table ${session.tableNumber}`;

                                    return (
                                        <TableRow 
                                            key={session.id} 
                                            onClick={() => handleSelectSession(session.id)}
                                            className="cursor-pointer"
                                            data-state={selectedSessionId === session.id ? 'selected' : undefined}
                                        >
                                            <TableCell className="font-medium">{identifier}</TableCell>
                                            <TableCell>{getFormattedDate(session.closedAt)}</TableCell>
                                            <TableCell>₱{(session.paymentSummary?.grandTotal || 0).toFixed(2)}</TableCell>
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
