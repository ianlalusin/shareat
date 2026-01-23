
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, Users, BarChart } from "lucide-react";

// Inline SVG for Peso Sign
const PesoSign = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M8 19V5" />
    <path d="M12 12h4" />
    <path d="M12 8h4" />
    <path d="M8 12h8" />
  </svg>
);


export type DashboardStats = {
    netSales: number;
    transactions: number;
    avgBasket: number;
};

interface StatCardsProps {
    stats: DashboardStats;
    activeSessions?: number;
    isLoading: boolean;
}

function StatCard({ title, value, icon, isLoading, format = "number" }: { title: string, value: string | number, icon: React.ReactNode, isLoading: boolean, format?: "currency" | "number" }) {
    
    const formattedValue = () => {
        if (isLoading) return "—";
        if (typeof value === "string") return value;

        const n = typeof value === "number" && Number.isFinite(value) ? value : 0;

        if (format === "currency") {
            return `₱${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        return n.toLocaleString("en-US");
    };

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
            <StatCard title="Net Sales" value={stats.netSales} icon={<PesoSign className="h-4 w-4 text-muted-foreground" />} isLoading={isLoading} format="currency" />
            <StatCard title="Transactions" value={stats.transactions} icon={<Receipt className="h-4 w-4 text-muted-foreground" />} isLoading={isLoading} />
            {activeSessions !== undefined && <StatCard title="Active Sessions" value={activeSessions} icon={<Users className="h-4 w-4 text-muted-foreground" />} isLoading={isLoading} />}
            <StatCard title="Avg Spending" value={stats.avgBasket} icon={<BarChart className="h-4 w-4 text-muted-foreground" />} isLoading={isLoading} format="currency" />
        </>
    );
}
