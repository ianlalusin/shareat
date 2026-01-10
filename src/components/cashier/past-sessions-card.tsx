
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Timestamp } from "firebase/firestore";
import { format } from 'date-fns';
import { Button } from "../ui/button";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";

export type PastSession = {
    id: string;
    sessionId: string;
    tableNumber: string | null;
    customerName: string | null;
    sessionMode: 'package_dinein' | 'alacarte';
    closedAt?: Timestamp;
    createdAt: Timestamp;
    paymentSummary?: {
        grandTotal: number;
        totalPaid: number;
    };
    total: number;
};

interface PastSessionsCardProps {
    sessions: PastSession[];
}

export function PastSessionsCard({ sessions }: PastSessionsCardProps) {
    const totalRevenue = sessions.reduce((sum, s) => sum + (s.total || s.paymentSummary?.grandTotal || 0), 0);
    const router = useRouter();

    return (
        <Card>
            <CardHeader>
                <CardTitle>Today's Closed Sessions</CardTitle>
                <CardDescription>
                    A summary of all sessions completed today.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="p-4 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">Closed Sessions</p>
                        <p className="text-2xl font-bold">{sessions.length}</p>
                    </div>
                     <div className="p-4 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">Total Paid</p>
                        <p className="text-2xl font-bold">₱{totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                </div>
            </CardContent>
            <CardFooter>
                 <Button className="w-full" variant="outline" onClick={() => router.push('/receipts')}>
                    <Receipt className="mr-2"/> View All Receipts
                </Button>
            </CardFooter>
        </Card>
    );
}
