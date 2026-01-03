
"use client";

import { useState, useEffect } from "react";
import { collection, query, where, onSnapshot, orderBy, limit, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toJsDate } from "@/lib/utils/date";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

type VoidedSession = {
    id: string;
    tableNumber?: string | null;
    sessionLabel?: string | null;
    packageSnapshot?: { name: string };
    packageOfferingId?: string;
    servedRefillsByName?: Record<string, number>;
    voidReason?: string;
    voidedAt?: any;
    voidedByUsername?: string;
    verifiedAt?: any;
    updatedAt?: any;
}

interface VoidedOrdersCardProps {
    storeId: string;
    dateRange: { start: Date, end: Date };
}

function formatRefills(refills: Record<string, number> | undefined): string {
    if (!refills || Object.keys(refills).length === 0) return "—";
    return Object.entries(refills)
        .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
        .map(([name, count]) => `${name} x${count}`)
        .join(", ");
}

export function VoidedOrdersCard({ storeId, dateRange }: VoidedOrdersCardProps) {
    const [voided, setVoided] = useState<VoidedSession[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!storeId) return;
        setIsLoading(true);

        const sessionsRef = collection(db, "stores", storeId, "sessions");
        const q = query(
            sessionsRef,
            where("status", "==", "voided"),
            where("voidedAt", ">=", Timestamp.fromDate(dateRange.start)),
            where("voidedAt", "<=", Timestamp.fromDate(dateRange.end)),
            orderBy("voidedAt", "desc"),
            limit(20)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            setVoided(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as VoidedSession)));
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching voided sessions:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [storeId, dateRange]);

    if (isLoading) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle>Voided Orders</CardTitle>
                    <CardDescription>Sessions voided within the selected date range.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                </CardContent>
            </Card>
        )
    }

    if (voided.length === 0) {
        return null; // Don't show the card if there are no voided orders
    }

    return (
        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="voided-orders">
                <Card>
                    <AccordionTrigger className="w-full p-6 text-left">
                        <div className="flex items-center justify-between w-full">
                            <div>
                                <CardTitle>Voided Orders</CardTitle>
                                <CardDescription>Sessions voided within the selected date range.</CardDescription>
                            </div>
                            <Badge variant="destructive">{voided.length}</Badge>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Identifier</TableHead>
                                        <TableHead>Served Refills</TableHead>
                                        <TableHead>Void Reason</TableHead>
                                        <TableHead>Voided By</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {voided.map(v => (
                                        <TableRow key={v.id}>
                                            <TableCell>
                                                <div className="font-medium">{v.sessionLabel || `Table ${v.tableNumber}`}</div>
                                                <div className="text-xs text-muted-foreground">{v.packageSnapshot?.name || v.packageOfferingId}</div>
                                            </TableCell>
                                            <TableCell>{formatRefills(v.servedRefillsByName)}</TableCell>
                                            <TableCell>{v.voidReason}</TableCell>
                                            <TableCell>
                                                <div>{v.voidedByUsername || "N/A"}</div>
                                                <div className="text-xs text-muted-foreground">{toJsDate(v.voidedAt) ? format(toJsDate(v.voidedAt)!, 'p') : ''}</div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </AccordionContent>
                </Card>
            </AccordionItem>
        </Accordion>
    );
}
