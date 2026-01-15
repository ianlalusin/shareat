
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, doc, getDoc, query, where, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { DailyMetric } from "@/lib/types";
import { mergeWith } from "lodash";

export type DatePreset = "today" | "yesterday" | "week" | "month" | "custom";
export type DashboardStats = { netSales: number; transactions: number; avgBasket: number; };
export type YtdTally = DashboardStats & { mop: Record<string, number> };
export type TrendRow = { month: number, curGross: number, prevGross: number, curTx: number, prevTx: number };

const NULL_YTD_TALLY: YtdTally = { netSales: 0, transactions: 0, avgBasket: 0, mop: {} };
const EMPTY_TREND_ROWS = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, curGross: 0, prevGross: 0, curTx: 0, prevTx: 0 }));

// --- Date Helpers ---
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function isSameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtDate(d: Date) { return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }); }

// --- Data Fetching Helpers ---

export async function fetchPartialDays(
  db: any,
  storeId: string,
  startInclusive: Date,
  endExclusive: Date
): Promise<DailyMetric[]> {
  if (startInclusive >= endExclusive) return [];

  const ref = collection(db, "stores", storeId, "analytics"); // daily
  const q = query(
    ref,
    where("meta.dayStartMs", ">=", startInclusive.getTime()),
    where("meta.dayStartMs", "<", endExclusive.getTime())
  );

  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as DailyMetric);
}

export async function fetchYearMonths(db: any, storeId: string, year: number) {
  const monthIds = Array.from({ length: 12 }, (_, i) => `${year}${String(i + 1).padStart(2, "0")}`);
  const refs = monthIds.map((id) => doc(db, "stores", storeId, "analyticsMonths", id));
  const snaps = await Promise.all(refs.map((r) => getDoc(r)));

  return snaps.map((s, idx) => ({ monthId: monthIds[idx], data: s.exists() ? s.data() : null }));
}

export async function fetchYearDoc(db: any, storeId: string, year: number) {
  const ref = doc(db, "stores", storeId, "analyticsYears", String(year));
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// --- Aggregation Helpers ---

function sumMonthsUpTo(monthDocs: any[], upToIndexExclusive: number): YtdTally {
  let gross = 0, tx = 0;
  const mop: Record<string, number> = {};

  for (let i = 0; i < upToIndexExclusive; i++) {
    const d = monthDocs[i]?.data;
    if (!d) continue;

    gross += d?.payments?.totalGross ?? 0;
    tx += d?.payments?.txCount ?? 0;

    const byMethod = d?.payments?.byMethod ?? {};
    for (const [k, v] of Object.entries(byMethod)) mop[k] = (mop[k] || 0) + (v as number);
  }
  return { netSales: gross, transactions: tx, avgBasket: tx > 0 ? gross / tx : 0, mop };
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
    const netSales = dailyMetrics.reduce((sum, metric) => sum + (metric.payments?.totalGross || 0), 0);
    const transactions = dailyMetrics.reduce((sum, metric) => sum + (metric.payments?.txCount || 0), 0);
    const avgBasket = transactions > 0 ? netSales / transactions : 0;
    const mop: Record<string, number> = {};
    dailyMetrics.forEach(metric => {
        const methods = metric.payments?.byMethod ?? {};
        for (const [method, amount] of Object.entries(methods)) {
            mop[method] = (mop[method] || 0) + amount;
        }
    });
    return { netSales, transactions, avgBasket, mop };
}

function customMerger(objValue: any, srcValue: any) {
  if (typeof objValue === 'number' && typeof srcValue === 'number') {
    return objValue + srcValue;
  }
  if (typeof objValue === 'object' && typeof srcValue === 'object' && !Array.isArray(objValue)) {
      return mergeWith({}, objValue, srcValue, customMerger);
  }
}


interface UseDashboardAnalyticsProps {
    storeId?: string | null;
    preset: DatePreset;
    customRange: { start: Date; end: Date } | null;
    ytdMode: boolean;
}

export function useDashboardAnalytics({ storeId, preset, customRange, ytdMode }: UseDashboardAnalyticsProps) {
    // --- STATE VARIABLES ---
    const [isLoading, setIsLoading] = useState(true);
    const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
    const [activeSessions, setActiveSessions] = useState(0);
    const [trendRows, setTrendRows] = useState<TrendRow[]>([]);
    const [ytdData, setYtdData] = useState<{ cur: YtdTally, prev: YtdTally, range: {start: Date, end: Date} }>({ cur: NULL_YTD_TALLY, prev: NULL_YTD_TALLY, range: {start: new Date(), end: new Date()}});
    
    // --- DERIVED STATE (Date Range) ---
    const dateRange = useMemo(() => {
        const now = new Date();
        let s = new Date(), e = new Date();
        switch (preset) {
            case "today": s = startOfDay(now); e = endOfDay(now); break;
            case "yesterday": s = startOfDay(new Date(new Date().setDate(now.getDate() - 1))); e = endOfDay(s); break;
            case "week": 
                s = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()));
                e = endOfDay(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6));
                break;
            case "month": s = new Date(now.getFullYear(), now.getMonth(), 1); break;
            case "custom": if (customRange) { s = startOfDay(customRange.start); e = endOfDay(customRange.end); } break;
        }
        return { start: s, end: e };
    }, [preset, customRange]);

    // --- MAIN DATA FETCHING EFFECT ---
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
                setDailyMetrics([]); // Clear daily data to prevent flashes
                
                const today = new Date();
                const currentYear = today.getFullYear();
                const prevYear = currentYear - 1;
                const currentMonthIndex = today.getMonth();

                const [curYearMonths, prevYearMonths] = await Promise.all([
                    fetchYearMonths(db, storeId, currentYear),
                    fetchYearMonths(db, storeId, prevYear),
                ]);
                if (cancelled) return;

                setTrendRows(buildMonthlyTrendRows(curYearMonths, prevYearMonths));

                const curMonthStart = new Date(currentYear, currentMonthIndex, 1);
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                const tomorrowStart = startOfDay(tomorrow);
                const curMonthDailies = await fetchPartialDays(db, storeId, curMonthStart, tomorrowStart);
                if (cancelled) return;
                
                const cutoffPrev = new Date(prevYear, today.getMonth(), Math.min(today.getDate(), 28));
                const prevMonthStart = new Date(prevYear, currentMonthIndex, 1);
                const dayAfterCutoffPrev = new Date(cutoffPrev);
                dayAfterCutoffPrev.setDate(cutoffPrev.getDate() + 1);
                const dayAfterCutoffPrevStart = startOfDay(dayAfterCutoffPrev);
                const prevMonthDailies = await fetchPartialDays(db, storeId, prevMonthStart, dayAfterCutoffPrevStart);
                if (cancelled) return;

                const curFullMonthsTotal = sumMonthsUpTo(curYearMonths, currentMonthIndex);
                const curPartialMonthTotal = aggregateDailies(curMonthDailies);
                const finalCurYtd = mergeWith({}, curFullMonthsTotal, curPartialMonthTotal, customMerger);
                finalCurYtd.avgBasket = finalCurYtd.transactions > 0 ? finalCurYtd.netSales / finalCurYtd.transactions : 0;
                
                const prevFullMonthsTotal = sumMonthsUpTo(prevYearMonths, currentMonthIndex);
                const prevPartialMonthTotal = aggregateDailies(prevMonthDailies);
                const finalPrevYtd = mergeWith({}, prevFullMonthsTotal, prevPartialMonthTotal, customMerger);
                finalPrevYtd.avgBasket = finalPrevYtd.transactions > 0 ? finalPrevYtd.netSales / finalPrevYtd.transactions : 0;
                
                setYtdData({ cur: finalCurYtd, prev: finalPrevYtd, range: {start: new Date(currentYear, 0, 1), end: today} });
                
            } else {
                setTrendRows([]); // Clear YTD data to prevent flashes
                setYtdData({ cur: NULL_YTD_TALLY, prev: NULL_YTD_TALLY, range: {start: new Date(), end: new Date()} });
                
                const tomorrow = new Date(dateRange.end);
                tomorrow.setDate(dateRange.end.getDate() + 1);
                const tomorrowStart = startOfDay(tomorrow);
                const metrics = await fetchPartialDays(db, storeId, dateRange.start, tomorrowStart);
                if (cancelled) return;
                setDailyMetrics(metrics);
            }
        }
        
        fetchData().finally(() => {
            if (!cancelled) setIsLoading(false);
        });

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
        if (ytdMode) return ytdData.cur;
        if (!dailyMetrics || dailyMetrics.length === 0) return { netSales: 0, transactions: 0, avgBasket: 0 };
        return aggregateDailies(dailyMetrics);
    }, [dailyMetrics, ytdMode, ytdData.cur]);

    const paymentMix = useMemo<Record<string, number>>(() => {
        if (ytdMode) return ytdData.cur.mop;
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
    }, [dailyMetrics, ytdMode, ytdData.cur.mop]);

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

    