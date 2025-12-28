"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { Timestamp } from "firebase/firestore";
import { useState, useEffect } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";

export type ActiveSession = {
    id: string;
    tableNumber: string;
    status: 'active' | 'pending_verification';
    sessionMode: 'package_dinein' | 'alacarte';
    customer?: { name?: string | null };
    currentSessionId: string | null;
    startedAt?: Timestamp;
    packageSnapshot?: { name?: string };
    guestCountCashier?: number;
    guestCountServer?: number;
    guestCountFinal?: number;
};

const TimeElapsed = ({ startTime }: { startTime: Timestamp | undefined }) => {
    const [elapsed, setElapsed] = useState("0m");

    useEffect(() => {
        if (!startTime) return;

        const updateElapsed = () => {
            const now = Date.now();
            // Firestore Timestamps have a `toMillis` function. JS Dates do not.
            // This handles cases where the timestamp might have been converted.
            const start = typeof (startTime as any).toMillis === 'function' 
                ? (startTime as any).toMillis() 
                : new Date(startTime as any).getTime();

            if (isNaN(start)) {
                console.warn("Invalid startTime prop in TimeElapsed:", startTime);
                return;
            }

            const totalMinutes = Math.floor((now - start) / 60000);

            if (totalMinutes < 60) {
                setElapsed(`${totalMinutes}m`);
            } else {
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                const paddedMinutes = minutes < 10 ? `0${minutes}` : minutes;
                setElapsed(`${hours}:${paddedMinutes}`);
            }
        };

        const timer = setInterval(updateElapsed, 1000 * 30); // Update every 30 seconds
        updateElapsed(); // Initial calculation

        return () => clearInterval(timer);
    }, [startTime]);

    return (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock size={12} />
            {elapsed}
        </div>
    );
};

export function ActiveSessionsGrid({ sessions }: { sessions: ActiveSession[] }) {
    const router = useRouter();

    if (sessions.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Active Sessions</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-center text-muted-foreground py-10">No active sessions.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Active Sessions</CardTitle>
                <CardDescription>Click a session to view its bill. Red-bordered sessions are pending verification.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sessions.map(session => {
                    const isAlaCarte = session.sessionMode === 'alacarte';
                    const title = isAlaCarte ? session.customer?.name : `Table ${session.tableNumber}`;
                    const subtitle = isAlaCarte ? "Ala Carte" : session.packageSnapshot?.name;
                    
                    const final = Number(session.guestCountFinal ?? NaN);
                    const cashier = Number(session.guestCountCashier ?? 0);
                    const server = Number(session.guestCountServer ?? 0);
                    const guests = Number.isFinite(final) ? final : Math.max(cashier, server);

                    const isPending = session.status === 'pending_verification';
                    
                    return (
                    <Card
                        key={session.id}
                        className={cn(
                            "transition-colors",
                            isPending 
                                ? "border-red-500 cursor-not-allowed opacity-90" 
                                : "cursor-pointer hover:bg-muted/50"
                        )}
                        onClick={() => {
                            if (isPending) return;
                            router.push(`/cashier?sessionId=${session.id}`)
                        }}
                    >
                        <CardHeader>
                            <div className="flex justify-between items-center">
                                <CardTitle className="text-xl truncate">{title}</CardTitle>
                                <TimeElapsed startTime={session.startedAt} />
                            </div>
                            <CardDescription className="truncate">{subtitle}</CardDescription>
                        </CardHeader>
                        <CardContent className="flex justify-between items-center">
                            {!isAlaCarte ? (
                                <p className="text-sm font-medium">{guests} Guests</p>
                            ): <div></div>}
                            {isPending && <Badge variant="outline" className="border-red-500 text-red-500">Pending</Badge>}
                        </CardContent>
                    </Card>
                )})}
            </CardContent>
        </Card>
    );
}
