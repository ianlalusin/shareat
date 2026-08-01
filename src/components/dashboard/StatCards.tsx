
"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, Users, BarChart } from "lucide-react";
import type { DailyMetric } from "@/lib/types";
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

// Verbose "1 hour 30 minutes" / "45 minutes" label (no seconds — these are averages).
function fmtDurationShort(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    if (minutes > 0 || hours === 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    return parts.join(" ");
}

// A stat card split into two labelled columns.
function SplitStatCard({ title, icon, leftLabel = "Dine In", rightLabel = "Ala carte", left, right, footnote, isLoading, href }: {
    title: string;
    icon: React.ReactNode;
    leftLabel?: string;
    rightLabel?: string;
    left: string;
    right: string;
    footnote?: string;
    isLoading: boolean;
    /** When set, the whole card becomes a link (same treatment as Net Sales). */
    href?: string;
}) {
    const card = (
        <Card className={href ? "h-full hover:bg-muted/50 transition-colors" : "h-full"}>
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
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{leftLabel}</p>
                                <p className="text-xl font-bold tabular-nums">{left}</p>
                            </div>
                            <div className="flex-1 pl-4">
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rightLabel}</p>
                                <p className="text-xl font-bold tabular-nums">{right}</p>
                            </div>
                        </div>
                        {footnote && <p className="text-[10px] text-muted-foreground mt-2">{footnote}</p>}
                    </>
                )}
            </CardContent>
        </Card>
    );

    return href ? <Link href={href} className="block h-full">{card}</Link> : card;
}

interface StatCardsProps {
    stats: DashboardStats;
    activeSessions?: { count: number; guests: number };
    dailyMetrics?: DailyMetric[];
    isLoading: boolean;
    /**
     * Destination for the Transactions card. Left undefined for roles that
     * cannot open it (the Daily Session Timeline is admin/manager only, while
     * this dashboard is also shown to cashiers) so they don't hit a redirect.
     */
    transactionsHref?: string;
}

// Net Sales: big bold total, then a discount | charges footer (matches the
// two-data height of the Transactions / Average Basket split cards).
function NetSalesCard({ netSales, discounts, charges, isLoading }: {
    netSales: number;
    discounts: number;
    charges: number;
    isLoading: boolean;
}) {
    return (
        <Link href="/receipts" className="block h-full">
            <Card className="h-full hover:bg-muted/50 transition-colors">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Net Sales</CardTitle>
                    <PesoSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <Skeleton className="h-8 w-3/4" />
                    ) : (
                        <>
                            <div className="text-2xl font-bold tabular-nums">{peso(netSales)}</div>
                            <div className="mt-3 flex items-stretch divide-x border-t pt-2">
                                <div className="flex-1 pr-4">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Discount</p>
                                    <p className="text-sm font-semibold tabular-nums text-destructive">- {peso(discounts)}</p>
                                </div>
                                <div className="flex-1 pl-4">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Charges</p>
                                    <p className="text-sm font-semibold tabular-nums text-green-600">+ {peso(charges)}</p>
                                </div>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </Link>
    );
}

// Active Sessions: sessions | guests split, with the avg dine-in session
// duration as a footnote (so its height matches the other split cards).
function ActiveSessionsCard({ count, guests, avgSessionMs, isLoading }: {
    count: number;
    guests: number;
    avgSessionMs: number;
    isLoading: boolean;
}) {
    return (
        <Link href="/cashier" className="block h-full">
            <Card className="h-full hover:bg-muted/50 transition-colors">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <Skeleton className="h-8 w-3/4" />
                    ) : (
                        <>
                            <div className="flex items-stretch divide-x">
                                <div className="flex-1 pr-4">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Sessions</p>
                                    <p className="text-xl font-bold tabular-nums">{count.toLocaleString("en-US")}</p>
                                </div>
                                <div className="flex-1 pl-4">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Guests</p>
                                    <p className="text-xl font-bold tabular-nums">{guests.toLocaleString("en-US")}</p>
                                </div>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-2">
                                Average dine-in session: <span className="font-medium text-foreground">{fmtDurationShort(avgSessionMs)}</span>
                            </p>
                        </>
                    )}
                </CardContent>
            </Card>
        </Link>
    );
}

export function StatCards({ stats, activeSessions, dailyMetrics = [], isLoading, transactionsHref }: StatCardsProps) {
    const { discounts, charges, avgSessionMs } = useMemo(() => {
        let d = 0;
        let c = 0;
        let durMs = 0;
        let durCount = 0;
        dailyMetrics.forEach((m) => {
            d += m.payments?.discountsTotal ?? 0;
            c += m.payments?.chargesTotal ?? 0;
            durMs += m.sessions?.dineInDurationMsSum ?? 0;
            durCount += m.sessions?.dineInDurationCount ?? 0;
        });
        return { discounts: d, charges: c, avgSessionMs: durCount > 0 ? durMs / durCount : 0 };
    }, [dailyMetrics]);

    return (
        <>
            <NetSalesCard netSales={stats.netSales} discounts={discounts} charges={charges} isLoading={isLoading} />
            <SplitStatCard
              title="Transactions"
              icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
              left={stats.txDineIn.toLocaleString("en-US")}
              right={stats.txAlacarte.toLocaleString("en-US")}
              footnote={`${stats.transactions.toLocaleString("en-US")} total sessions`}
              isLoading={isLoading}
              href={transactionsHref}
            />
            {activeSessions !== undefined && (
              <ActiveSessionsCard
                count={activeSessions.count}
                guests={activeSessions.guests}
                avgSessionMs={avgSessionMs}
                isLoading={isLoading}
              />
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
