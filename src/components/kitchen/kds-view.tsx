
"use client";

import { useState, useEffect } from "react";
import { KitchenTicket } from "@/app/kitchen/page";
import { KdsItemCard } from "./kds-item-card";

interface KdsViewProps {
    tickets: KitchenTicket[];
    onUpdateStatus: (ticketId: string, sessionId: string, newStatus: "ready" | "cancelled", reason?: string) => void;
}

export function KdsView({ tickets, onUpdateStatus }: KdsViewProps) {
    if (tickets.length > 0) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {tickets.map(ticket => (
                    <KdsItemCard
                        key={ticket.id}
                        ticket={ticket}
                        onUpdateStatus={onUpdateStatus}
                    />
                ))}
            </div>
        );
    }

    return (
        <div className="text-center text-muted-foreground py-20">
            No active orders for this station.
        </div>
    );
}
