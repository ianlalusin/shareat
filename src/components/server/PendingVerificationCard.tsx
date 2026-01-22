
"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { SessionCard } from "./SessionCard";
import type { PendingSession } from "@/lib/types";

interface PendingVerificationCardProps {
    sessions: PendingSession[];
    onVerify: (session: PendingSession, serverCount: number) => void;
    onRequestChange: (session: PendingSession) => void;
    onViewTimeline: (sessionId: string) => void;
    onAddRefill: (session: PendingSession) => void;
    onAddAddon: (session: PendingSession) => void;
}

export function PendingVerificationCard({ sessions, onVerify, onRequestChange, onViewTimeline, onAddRefill, onAddAddon }: PendingVerificationCardProps) {
    const [guestCounts, setGuestCounts] = useState<Record<string, number | string>>({});

    useEffect(() => {
        const initialCounts: Record<string, number | string> = {};
        sessions.forEach(session => {
            const cashierCount = Number(session.guestCountCashierInitial ?? 0);
            if (guestCounts[session.id] === undefined) {
                initialCounts[session.id] = cashierCount;
            }
        });
        if (Object.keys(initialCounts).length > 0) {
            setGuestCounts(prev => ({ ...initialCounts, ...prev }));
        }
    }, [sessions, guestCounts]);

    const handleCountChange = (sessionId: string, value: string | number) => {
        setGuestCounts(prev => ({
            ...prev,
            [sessionId]: value
        }));
    };
    
    if (sessions.length === 0) {
        return (
            <Card>
                <CardHeader className="flex flex-row items-center justify-between p-6">
                    <div className="text-left">
                        <CardTitle>Pending Verification</CardTitle>
                        <CardDescription>Sessions waiting for server confirmation.</CardDescription>
                    </div>
                    <Badge variant="secondary">0</Badge>
                </CardHeader>
            </Card>
        );
    }
    
    return (
        <Accordion type="single" collapsible defaultValue="pending" className="w-full">
            <AccordionItem value="pending">
                 <Card>
                    <CardHeader className="p-0">
                         <AccordionTrigger className="flex items-center gap-4 p-6">
                            <div className="text-left">
                                <CardTitle>Pending Verification</CardTitle>
                                <CardDescription>Sessions waiting for server confirmation.</CardDescription>
                            </div>
                            <Badge variant="destructive">{sessions.length}</Badge>
                         </AccordionTrigger>
                    </CardHeader>
                    <AccordionContent>
                        <CardContent className="grid sm:grid-cols-1 gap-4 pt-4">
                            {sessions.map(session => (
                                <SessionCard
                                    key={session.id}
                                    session={session}
                                    onVerify={onVerify}
                                    onRequestChange={onRequestChange}
                                    onViewTimeline={onViewTimeline}
                                    onAddRefill={onAddRefill}
                                    onAddAddon={onAddAddon}
                                    guestCounts={guestCounts}
                                    handleCountChange={handleCountChange}
                                />
                            ))}
                        </CardContent>
                    </AccordionContent>
                 </Card>
            </AccordionItem>
        </Accordion>
    );
}
