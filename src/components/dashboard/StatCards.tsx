
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, Users, BarChart } from "lucide-react";
import Link from "next/link";

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
    avgDineIn: number;    // avg net per dine-in package guest (per head)
    avgAlacarte: number;  // avg net per ala carte (non-package) bill
    txDineIn: number;     // dine-in session count
    txAlacarte: number;   // ala carte session count
};

function peso(n: number) {
    const v = Number.isFinite(n) ? n : 0;
    return `₱${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// A stat card split into two columns: Dine In | Ala carte.
function SplitStatCard({ title, icon, left, right, footnote, isLoading }: {
    title: string;
    icon: React.ReactNode;
    left: string;
    right: string;
    footnote?: string;
    isLoading: boolean;
}) {
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
                    <>
                        <div className="flex items-stretch divide-x">
                            <div className="flex-1 pr-4">
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Dine In</p>
                                <p className="text-xl font-bold tabular-nums">{left}</p>
                            </div>
                            <div className="flex-1 pl-4">
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Ala carte</p>
                                <p className="text-xl font-bold tabular-nums">{right}</p>
                            </div>
                        </div>
                        {footnote && <p className="text-[10px] text-muted-foreground mt-2">{footnote}</p>}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

interface StatCardsProps {
    stats: DashboardStats;
    activeSessions?: { count: number; guests: number };
    isLoading: boolean;
}

function StatCard({ title, value, description, icon, isLoading, format = "number", className }: { title: string, value: string | number, description?: string, icon: React.ReactNode, isLoading: boolean, format?: "currency" | "number", className?: string }) {
    
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
        <Card className={className}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                {icon}
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <Skeleton className="h-8 w-3/4" />
                ) : (
                    <>
                        <div className="text-2xl font-bold">{formattedValue()}</div>
                        {description && <p className="text-xs text-muted-foreground">{description}</p>}
                    </>
                )}
            </CardContent>
        </Card>
    )
}

export function StatCards({ stats, activeSessions, isLoading }: StatCardsProps) {
    return (
        <>
            <Link href="/receipts">
              <StatCard title="Net Sales" value={stats.netSales} icon={<PesoSign className="h-4 w-4 text-muted-foreground" />} isLoading={isLoading} format="currency" className="hover:bg-muted/50 transition-colors" />
            </Link>
            <SplitStatCard
              title="Transactions"
              icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
              left={stats.txDineIn.toLocaleString("en-US")}
              right={stats.txAlacarte.toLocaleString("en-US")}
              footnote={`${stats.transactions.toLocaleString("en-US")} total sessions`}
              isLoading={isLoading}
            />
            {activeSessions !== undefined && (
              <Link href="/cashier">
                <StatCard 
                  title="Active Sessions" 
                  value={`${activeSessions.count} - ${activeSessions.guests} guests`} 
                  icon={<Users className="h-4 w-4 text-muted-foreground" />} 
                  isLoading={isLoading} 
                  className="hover:bg-muted/50 transition-colors"
                />
              </Link>
            )}
            <SplitStatCard
              title="Average Basket"
              icon={<BarChart className="h-4 w-4 text-muted-foreground" />}
              left={stats.avgDineIn > 0 ? peso(stats.avgDineIn) : "—"}
              right={stats.avgAlacarte > 0 ? peso(stats.avgAlacarte) : "—"}
              footnote="Dine-in: per guest · Ala carte: per bill"
              isLoading={isLoading}
            />
        </>
    );
}
