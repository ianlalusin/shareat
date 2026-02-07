
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { Timestamp } from "firebase/firestore";
import { useState, useEffect } from "react";
import { Clock, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { toJsDate } from "@/lib/utils/date";
import { useAuthContext } from "@/context/auth-context";
import { VoidSessionDialog } from "./void-session-dialog";
import { Button } from "../ui/button";

export type ActiveSession = {
    id: string;
    storeId: string;
    tableNumber: string;
    tableDisplayName?: string | null;
    status: 'active' | 'pending_verification';
    sessionMode: 'package_dinein' | 'alacarte';
    customer?: { name?: string | null };
    customerName?: string | null;
    currentSessionId: string | null;
    startedAt?: Timestamp | null;
    startedAtClientMs?: number | null;
    packageName?: string;
    guestCountCashierInitial?: number;
    guestCountServerVerified?: number | null;
    guestCountFinal?: number | null;
    isPaid?: boolean; // Added for validation
};

const TimeElapsed = ({ startTime, startTimeMs }: { startTime: any, startTimeMs: number | null }) => {
    const [elapsed, setElapsed] = useState("...");
    const jsDate = startTimeMs ? new Date(startTimeMs) : toJsDate(startTime);

    useEffect(() => {
        if (!jsDate) {
            setElapsed("...");
            return;
        }

        const updateElapsed = () => {
            const now = Date.now();
            const totalMinutes = Math.floor((now - jsDate.getTime()) / 60000);

            if (totalMinutes < 0) { // Handle case where client time is behind server time
                setElapsed("0m");
                return;
            }

            if (totalMinutes < 60) {
                setElapsed(`${totalMinutes}m`);
            } else {
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                const paddedMinutes = minutes < 10 ? `0${minutes}` : minutes;
                setElapsed(`${hours}h ${paddedMinutes}m`);
            }
        };

        updateElapsed();
        const timer = setInterval(updateElapsed, 30000); // Update every 30 seconds

        return () => clearInterval(timer);
    }, [jsDate]);

    return (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock size={12} />
            {elapsed}
        </div>
    );
};

export function ActiveSessionsGrid({ sessions, storeId }: { sessions: ActiveSession[], storeId: string }) {
    const router = useRouter();
    const { appUser } = useAuthContext();
    const [voidingSession, setVoidingSession] = useState<ActiveSession | null>(null);

    const canVoid = appUser?.role === 'admin' || appUser?.role === 'manager';

    const handleVoidClick = (e: React.MouseEvent, session: ActiveSession) => {
        e.stopPropagation(); // Prevent navigation
        setVoidingSession(session);
    };

    const activeAndPendingSessions = sessions.filter(s => s.status === 'active' || s.status === 'pending_verification');

    if (activeAndPendingSessions.length === 0) {
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
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Active Sessions</CardTitle>
                    <CardDescription>Click a session to view its bill. Red-bordered sessions are pending verification.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activeAndPendingSessions.map(session => {
                        const isAlaCarte = session.sessionMode === 'alacarte';
                        const title = isAlaCarte ? (session.customer?.name || 'Ala Carte') : (session.tableDisplayName || `Table ${session.tableNumber}`);
                        const subtitle = isAlaCarte ? "Ala Carte" : session.packageName;
                        
                        const cashier = Number(session.guestCountCashierInitial ?? 0);
                        const server = Number(session.guestCountServerVerified ?? 0);
                        const final = session.guestCountFinal ?? Math.max(cashier, server);
                        const guests = final > 0 ? final : Math.max(cashier, server);

                        const isPending = session.status === 'pending_verification';
                        
                        return (
                        <div key={session.id} className="relative group">
                            <Card
                                className={cn(
                                    "transition-colors h-full",
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
                                        <TimeElapsed startTime={session.startedAt} startTimeMs={session.startedAtClientMs ?? null} />
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
                            {canVoid && (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => handleVoidClick(e, session)}
                                >
                                    <Ban className="h-4 w-4" />
                                    Void
                                </Button>
                            )}
                        </div>
                    )})}
                </CardContent>
            </Card>
            {voidingSession && appUser && storeId && (
                <VoidSessionDialog
                    isOpen={!!voidingSession}
                    onClose={() => setVoidingSession(null)}
                    session={voidingSession}
                    user={appUser}
                    storeId={storeId}
                />
            )}
        </>
    );
}
