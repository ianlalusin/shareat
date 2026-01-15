
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, doc, getDoc, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { DailyMetric } from "@/lib/types";

export type DatePreset = "today" | "yesterday" | "week" | "month" | "custom";
export type DashboardStats = { grossSales: number; transactions: number; avgBasket: number; };
export type YtdTally = DashboardStats & { mop: Record<string, number> };
export type TrendRow = { month: number, curGross: number, prevGross: number, curTx: number, prevTx: number };

const NULL_YTD_TALLY: YtdTally = { grossSales: 0, transactions: 0, avgBasket: 0, mop: {} };

// --- Date Helpers ---
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function isSameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtDate(d: Date) { return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }); }

async function fetchYearMonths(db: any, storeId: string, year: number) {
  const monthIds = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0");
    return `${year}${mm}`;
  });
  const refs = monthIds.map((id) => doc(db, "stores", storeId, "analyticsMonths", id));
  const snaps = await Promise.all(refs.map((r) => getDoc(r)));
  return snaps.map((s, idx) => ({ monthId: monthIds[idx], exists: s.exists(), data: (s.data() as any) ?? null }));
}

function sumMonthsUpTo(monthDocs: any[], upToIndexExclusive: number): YtdTally {
  let gross = 0, tx = 0;
  const mop: Record<string, number> = {};

  for (let i = 0; i < upToIndexExclusive; i++) {
    const d = monthDocs[i]?.data;
    if (!d) continue;

    gross += d?.payments?.totalGross ?? 0;
    tx += d?.payments?.txCount ?? 0;

    const byMethod = d?.payments?.byMethod ?? {};
    for (const [k, v] of Object.entries(byMethod)) mop[k] = (mop[k] ?? 0) + (v as number);
  }
  return { grossSales: gross, transactions: tx, avgBasket: tx > 0 ? gross / tx : 0, mop };
}

function buildMonthlyTrendRows(curMonths: any[], prevMonths: any[]): TrendRow[] {
  return Array.from({ length: 12 }, (_, i) => {
    const curData = curMonths[i]?.data;
    const prevData = prevMonths[i]?.data;
    return {
      month: i + 1,
      curGross: curData?.payments?.totalGross ?? 0,
      prevGross: prevData?.payments?.totalGross ?? 0,
      curTx: curData?.payments?.txCount ?? 0,
      prevTx: prevData?.payments?.txCount ?? 0,
    };
  });
}

function aggregateDailies(dailyMetrics: DailyMetric[]): YtdTally {
    const grossSales = dailyMetrics.reduce((sum, metric) => sum + (metric.payments?.totalGross || 0), 0);
    const transactions = dailyMetrics.reduce((sum, metric) => sum + (metric.payments?.txCount || 0), 0);
    const avgBasket = transactions > 0 ? grossSales / transactions : 0;
    const mop: Record<string, number> = {};
    dailyMetrics.forEach(metric => {
        const methods = metric.payments?.byMethod ?? {};
        for (const [method, amount] of Object.entries(methods)) {
            mop[method] = (mop[method] || 0) + amount;
        }
    });
    return { grossSales, transactions, avgBasket, mop };
}

async function fetchPartialMonth(storeId: string, start: Date, end: Date): Promise<DailyMetric[]> {
    if (start > end) return [];
    const metricsRef = collection(db, "stores", storeId, "analytics");
    const q = query(
        metricsRef,
        where("meta.dayStartMs", ">=", start.getTime()),
        where("meta.dayStartMs", "<=", end.getTime())
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data() as DailyMetric);
}


interface UseDashboardAnalyticsProps {
    storeId?: string | null;
    preset: DatePreset;
    customRange: { start: Date; end: Date } | null;
    ytdMode: boolean;
}

export function useDashboardAnalytics({ storeId, preset, customRange, ytdMode }: UseDashboardAnalyticsProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
    const [activeSessions, setActiveSessions] = useState(0);

    // YTD state
    const [trendRows, setTrendRows] = useState<TrendRow[]>([]);
    const [ytdData, setYtdData] = useState<{ cur: YtdTally, prev: YtdTally, range: DateRange }>({ cur: NULL_YTD_TALLY, prev: NULL_YTD_TALLY, range: {start: new Date(), end: new Date()}});
    
    const dateRange = useMemo(() => {
        const now = new Date();
        let s = new Date(), e = new Date();
        switch (preset) {
            case "today": s.setHours(0, 0, 0, 0); e.setHours(23, 59, 59, 999); break;
            case "yesterday": s.setDate(now.getDate() - 1); s.setHours(0, 0, 0, 0); e.setDate(now.getDate() - 1); e.setHours(23, 59, 59, 999); break;
            case "week": s.setDate(now.getDate() - now.getDay()); s.setHours(0, 0, 0, 0); break;
            case "month": s = new Date(now.getFullYear(), now.getMonth(), 1); break;
            case "custom": if (customRange) { s = startOfDay(customRange.start); e = endOfDay(customRange.end); } break;
        }
        return { start: s, end: e };
    }, [preset, customRange]);

    useEffect(() => {
        if (!storeId) {
            setIsLoading(false);
            setDailyMetrics([]);
            return;
        }

        let cancelled = false;
        setIsLoading(true);

        async function fetchData() {
            if (ytdMode) {
                // --- YTD MODE ---
                const today = new Date();
                const currentYear = today.getFullYear();
                const prevYear = currentYear - 1;
                const currentMonthIndex = today.getMonth(); // 0-11
                const currentDayOfMonth = today.getDate();

                const [curYearMonths, prevYearMonths] = await Promise.all([
                    fetchYearMonths(db, storeId, currentYear),
                    fetchYearMonths(db, storeId, prevYear),
                ]);
                if (cancelled) return;

                setTrendRows(buildMonthlyTrendRows(curYearMonths, prevYearMonths));

                // Partial month dailies for this year
                const curMonthStart = new Date(currentYear, currentMonthIndex, 1);
                const curMonthDailies = await fetchPartialMonth(storeId, curMonthStart, today);
                if (cancelled) return;
                
                // Partial month dailies for last year
                const prevYearCutoff = new Date(today);
                prevYearCutoff.setFullYear(prevYear);
                const prevMonthStart = new Date(prevYear, currentMonthIndex, 1);
                const prevMonthDailies = await fetchPartialMonth(storeId, prevMonthStart, prevYearCutoff);
                if (cancelled) return;

                // Combine full months + partial month
                const curFullMonthsTotal = sumMonthsUpTo(curYearMonths, currentMonthIndex);
                const curPartialMonthTotal = aggregateDailies(curMonthDailies);
                const finalCurYtd = mergeWith({}, curFullMonthsTotal, curPartialMonthTotal, customMerger);
                finalCurYtd.avgBasket = finalCurYtd.transactions > 0 ? finalCurYtd.grossSales / finalCurYtd.transactions : 0;
                
                const prevFullMonthsTotal = sumMonthsUpTo(prevYearMonths, currentMonthIndex);
                const prevPartialMonthTotal = aggregateDailies(prevMonthDailies);
                const finalPrevYtd = mergeWith({}, prevFullMonthsTotal, prevPartialMonthTotal, customMerger);
                finalPrevYtd.avgBasket = finalPrevYtd.transactions > 0 ? finalPrevYtd.grossSales / finalPrevYtd.transactions : 0;
                
                setYtdData({ cur: finalCurYtd, prev: finalPrevYtd, range: {start: new Date(currentYear, 0, 1), end: today} });
                
            } else {
                // --- STANDARD DATE RANGE MODE ---
                const metrics = await fetchPartialMonth(storeId, dateRange.start, dateRange.end);
                if (cancelled) return;
                setDailyMetrics(metrics);
            }
        }
        
        fetchData().finally(() => {
            if (!cancelled) setIsLoading(false);
        });

        // Live Active Sessions (always running)
        const sessionsRef = collection(db, "stores", storeId, "sessions");
        const activeSessionsQuery = query(sessionsRef, where("status", "in", ["active", "pending_verification"]));
        const unsubSessions = onSnapshot(activeSessionsQuery, (snapshot) => {
            setActiveSessions(snapshot.size);
        });

        return () => {
            cancelled = true;
            unsubSessions();
        };
    }, [storeId, dateRange.start, dateRange.end, ytdMode]);

    const stats = useMemo<DashboardStats>(() => {
        if (!dailyMetrics || dailyMetrics.length === 0) return { grossSales: 0, transactions: 0, avgBasket: 0 };
        const { grossSales, transactions, avgBasket } = aggregateDailies(dailyMetrics);
        return { grossSales, transactions, avgBasket };
    }, [dailyMetrics]);

    const paymentMix = useMemo<Record<string, number>>(() => {
        const mix: Record<string, number> = {};
        if (dailyMetrics) {
            dailyMetrics.forEach(metric => {
                const methods = metric.payments?.byMethod ?? {};
                for (const [method, amount] of Object.entries(methods)) {
                    mix[method] = (mix[method] || 0) + amount;
                }
            });
        }
        return mix;
    }, [dailyMetrics]);

    const dateRangeLabel = useMemo(() => {
        if (ytdMode) return `Year-to-Date (as of ${fmtDate(new Date())})`;
        return isSameDay(dateRange.start, dateRange.end) ? fmtDate(dateRange.start) : `${fmtDate(dateRange.start)} - ${fmtDate(dateRange.end)}`;
    }, [dateRange.start, dateRange.end, ytdMode]);

    return {
        isLoading,
        dateRangeLabel,
        stats,
        activeSessions,
        paymentMix,
        dailyMetrics,
        ytdData,
        trendRows
    };
}
