
"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { collection, query, where, orderBy, limit, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Store } from "@/app/admin/stores/page";
import { Loader2 } from "lucide-react";
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";

type PastSession = {
    id: string;
    tableNumber: string;
    customer?: { name?: string };
    sessionMode: 'package_dinein' | 'alacarte';
    closedAt: Timestamp;
    paymentSummary: {
        grandTotal: number;
    };
};

interface RecentReceiptsListProps {
    store: Store;
}

export function RecentReceiptsList({ store }: RecentReceiptsListProps) {
    const [sessions, setSessions] = useState<PastSession[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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
            setSessions(snapshot.docs.map(doc => doc.data() as PastSession));
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching recent sessions:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [store]);

    const handlePrint = (sessionId: string) => {
        const url = `/receipt/${sessionId}`;
        window.open(url, '_blank');
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Recent Receipts</CardTitle>
                <CardDescription>A list of the last 20 completed transactions.</CardDescription>
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
                                <TableHead className="text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sessions.length > 0 ? (
                                sessions.map(session => {
                                    const identifier = session.sessionMode === 'alacarte' 
                                        ? session.customer?.name || 'Ala Carte'
                                        : `Table ${session.tableNumber}`;

                                    return (
                                        <TableRow key={session.id}>
                                            <TableCell className="font-medium">{identifier}</TableCell>
                                            <TableCell>{session.closedAt ? format(session.closedAt.toDate(), 'p') : 'N/A'}</TableCell>
                                            <TableCell>₱{(session.paymentSummary?.grandTotal || 0).toFixed(2)}</TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="outline" size="sm" onClick={() => handlePrint(session.id)}>
                                                    Reprint
                                                </Button>
                                            </TableCell>
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
