
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, Receipt, Users, BarChart } from "lucide-react";

export type DashboardStats = {
    grossSales: number;
    transactions: number;
    avgTicket: number;
};

interface StatCardsProps {
    stats: DashboardStats;
    activeSessions: number;
    isLoading: boolean;
}

function StatCard({ title, value, icon, isLoading, format = "number" }: { title: string, value: string | number, icon: React.ReactNode, isLoading: boolean, format?: "currency" | "number" }) {
    
    const formattedValue = () => {
        if (typeof value === 'string') return value;
        if (format === 'currency') return `₱${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        return value.toLocaleString('en-US');
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                {icon}
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <Skeleton className="h-8 w-3/4" />
                ) : (
                    <div className="text-2xl font-bold">{formattedValue()}</div>
                )}
            </CardContent>
        </Card>
    )
}

export function StatCards({ stats, activeSessions, isLoading }: StatCardsProps) {
    return (
        <>
            <StatCard title="Gross Sales" value={stats.grossSales} icon={<DollarSign className="h-4 w-4 text-muted-foreground" />} isLoading={isLoading} format="currency" />
            <StatCard title="Transactions" value={stats.transactions} icon={<Receipt className="h-4 w-4 text-muted-foreground" />} isLoading={isLoading} />
            <StatCard title="Active Sessions" value={activeSessions} icon={<Users className="h-4 w-4 text-muted-foreground" />} isLoading={isLoading} />
            <StatCard title="Average Basket" value={stats.avgTicket} icon={<BarChart className="h-4 w-4 text-muted-foreground" />} isLoading={isLoading} format="currency" />
        </>
    );
}
