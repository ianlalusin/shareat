
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Timestamp } from "firebase/firestore";
import { format } from 'date-fns';
import { Button } from "../ui/button";
import { useRouter } from "next/navigation";

export type PastSession = {
    id: string;
    tableNumber: string;
    closedAt: Timestamp;
    paymentSummary: {
        grandTotal: number;
        totalPaid: number;
    };
};

interface PastSessionsCardProps {
    sessions: PastSession[];
}

export function PastSessionsCard({ sessions }: PastSessionsCardProps) {
    const totalRevenue = sessions.reduce((sum, s) => sum + (s.paymentSummary?.grandTotal || 0), 0);
    const router = useRouter();

    const handlePrint = (sessionId: string) => {
        const url = `/receipt/${sessionId}`;
        // Open in a new tab for better print UX
        window.open(url, '_blank');
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Today's Closed Sessions</CardTitle>
                <CardDescription>
                    Total revenue today: <strong>₱{totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Table</TableHead>
                            <TableHead>Time</TableHead>
                            <TableHead>Billed</TableHead>
                            <TableHead className="text-right">Receipt</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sessions.length > 0 ? (
                            sessions.map(session => (
                                <TableRow key={session.id}>
                                    <TableCell>{session.tableNumber}</TableCell>
                                    <TableCell>{format(session.closedAt.toDate(), 'p')}</TableCell>
                                    <TableCell>₱{(session.paymentSummary?.grandTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="outline" size="sm" onClick={() => handlePrint(session.id)}>
                                            Print
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center text-muted-foreground">No sessions closed yet today.</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
