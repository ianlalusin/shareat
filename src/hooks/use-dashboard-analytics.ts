
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, doc, getDoc, query, where, getDocs, onSnapshot, limit, orderBy, type DocumentReference } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { DailyMetric } from "@/lib/types";
import { mergeWith } from "lodash";
import { differenceInDays } from 'date-fns';

export type DatePreset = "today" | "yesterday" | "week" | "month" | "custom";
export type DashboardStats = { netSales: number; transactions: number; avgBasket: number; };
export type YtdTally = DashboardStats & { mop: Record<string, number> };
export type TrendRow = { month: number, curGross: number, prevGross: number, curTx: number, prevTx: number };
type AddonAgg = { itemName: string; categoryName: string; qty: number; amount: number };

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

// --- Top-N Addon Helpers ---
function mergeAddonAgg(target: Map<string, AddonAgg>, row: any) {
  const key = row.itemName;
  const cur = target.get(key) ?? { itemName: row.itemName, categoryName: row.categoryName ?? "Uncategorized", qty: 0, amount: 0 };
  cur.qty += row.qty ?? 0;
  cur.amount += row.amount ?? 0;
  if (!cur.categoryName && row.categoryName) cur.categoryName = row.categoryName;
  target.set(key, cur);
}

async function fetchTopAddonsForRollupDocs(
  rollupDocRefs: DocumentReference[],
  topN = 10
): Promise<AddonAgg[]> {
  const merged = new Map<string, AddonAgg>();

  await Promise.all(
    rollupDocRefs.map(async (ref) => {
      const itemsRef = collection(ref, "addonItems");
      const q = query(itemsRef, orderBy("amount", "desc"), limit(topN));
      const snap = await getDocs(q);
      snap.forEach((d) => mergeAddonAgg(merged, d.data()));
    })
  );

  return Array.from(merged.values())
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, topN);
}

function groupByCategory(items: AddonAgg[]) {
  const byCat: Record<string, { categoryName: string; qty: number; amount: number }> = {};
  for (const it of items) {
    const k = it.categoryName || "Uncategorized";
    byCat[k] = byCat[k] || { categoryName: k, qty: 0, amount: 0 };
    byCat[k].qty += it.qty;
    byCat[k].amount += it.amount;
  }
  return Object.values(byCat).sort((a, b) => b.amount - a.amount);
}


// --- Aggregation Helpers ---

function sumMonthsUpTo(monthDocs: any[], upToIndexExclusive: number): YtdTally {
  let netSales = 0, transactions = 0;
  let totalDineInSales = 0;
  let totalDineInGuests = 0;
  const mop: Record<string, number> = {};

  for (let i = 0; i < upToIndexExclusive; i++) {
    const d = monthDocs[i]?.data;
    if (!d) continue;

    netSales += d?.payments?.totalGross ?? 0;
    transactions += d?.payments?.txCount ?? 0;

    const packageSales = Object.values(d?.sales?.packageSalesAmountByName || {}).reduce((pkgSum, amount) => pkgSum + (amount as number), 0);
    totalDineInSales += packageSales;
    totalDineInGuests += d?.guests?.guestCountFinalTotal ?? 0;

    const byMethod = d?.payments?.byMethod ?? {};
    for (const [k, v] of Object.entries(byMethod)) mop[k] = (mop[k] || 0) + (v as number);
  }

  const avgSpending = totalDineInGuests > 0 ? totalDineInSales / totalDineInGuests : 0;
  return { netSales, transactions, avgBasket: avgSpending, mop };
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
    
    const totalDineInSales = dailyMetrics.reduce((sum, metric) => {
        const packageSales = Object.values(metric.sales?.packageSalesAmountByName || {}).reduce((pkgSum, amount) => pkgSum + amount, 0);
        return sum + packageSales;
    }, 0);
    const totalDineInGuests = dailyMetrics.reduce((sum, metric) => sum + (metric.guests?.guestCountFinalTotal || 0), 0);
    const avgSpending = totalDineInGuests > 0 ? totalDineInSales / totalDineInGuests : 0;
    
    const mop: Record<string, number> = {};
    dailyMetrics.forEach(metric => {
        const methods = metric.payments?.byMethod ?? {};
        for (const [method, amount] of Object.entries(methods)) {
            mop[method] = (mop[method] || 0) + amount;
        }
    });
    return { netSales, transactions, avgBasket: avgSpending, mop };
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

const MAX_DAYS_RANGE = 62; // ~2 months

export function useDashboardAnalytics({ storeId, preset, customRange, ytdMode }: UseDashboardAnalyticsProps) {
    // --- STATE VARIABLES ---
    const [isLoading, setIsLoading] = useState(true);
    const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
    const [topCategories, setTopCategories] = useState<ReturnType<typeof groupByCategory>>([]);
    const [activeSessions, setActiveSessions] = useState({ count: 0, guests: 0 });
    const [trendRows, setTrendRows] = useState<TrendRow[]>([]);
    const [ytdData, setYtdData] = useState<{ cur: YtdTally, prev: YtdTally, range: {start: Date, end: Date} }>({ cur: NULL_YTD_TALLY, prev: NULL_YTD_TALLY, range: {start: new Date(), end: new Date()} });
    
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
        let unsubscribeDailyMetrics: (() => void) | null = null;
        setIsLoading(true);

        const sessionsRef = collection(db, "stores", storeId, "sessions");
        const activeSessionsQuery = query(sessionsRef, where("status", "in", ["active", "pending_verification"]));
        const unsubSessions = onSnapshot(activeSessionsQuery, (snapshot) => {
            if (!cancelled) {
                let totalGuests = 0;
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const finalCount = data.guestCountFinal ?? data.guestCountServerVerified ?? data.guestCountCashierInitial ?? 0;
                    totalGuests += Number(finalCount);
                });
                setActiveSessions({
                    count: snapshot.size,
                    guests: totalGuests,
                });
            }
        });

        if (ytdMode) {
            async function fetchYtdData() {
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
                
                const monthIds = Array.from({ length: 12 }, (_, i) => `${currentYear}${String(i + 1).padStart(2, "0")}`);
                const monthRefs = monthIds.map(id => doc(db, 'stores', storeId, 'analyticsMonths', id));
                const topAddons = await fetchTopAddonsForRollupDocs(monthRefs, 20);
                if(cancelled) return;
                setTopCategories(groupByCategory(topAddons));
            }
            
            fetchYtdData().finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        } else {
            // --- REALTIME LOGIC FOR DAILY VIEW ---
            setTrendRows([]);
            setYtdData({ cur: NULL_YTD_TALLY, prev: NULL_YTD_TALLY, range: {start: new Date(), end: new Date()} });

            if (differenceInDays(dateRange.end, dateRange.start) > MAX_DAYS_RANGE) {
                 setDailyMetrics([]);
                 setTopCategories([]);
                 setIsLoading(false);
            } else {
                const tomorrow = new Date(dateRange.end);
                tomorrow.setDate(dateRange.end.getDate() + 1);
                const tomorrowStart = startOfDay(tomorrow);

                const ref = collection(db, "stores", storeId, "analytics");
                const q = query(
                    ref,
                    where("meta.dayStartMs", ">=", dateRange.start.getTime()),
                    where("meta.dayStartMs", "<", tomorrowStart.getTime())
                );

                unsubscribeDailyMetrics = onSnapshot(q, async (snapshot) => {
                    if (cancelled) return;

                    const metrics = snapshot.docs.map((d) => d.data() as DailyMetric);
                    setDailyMetrics(metrics);

                    if (metrics.length > 0) {
                        const dayRefs = metrics.map(m => doc(db, 'stores', storeId, 'analytics', m.meta.dayId));
                        const topAddons = await fetchTopAddonsForRollupDocs(dayRefs, 20);
                        if(cancelled) return;
                        setTopCategories(groupByCategory(topAddons));
                    } else {
                        setTopCategories([]);
                    }
                    setIsLoading(false);
                }, (error) => {
                    console.error("Dashboard daily metrics listener failed:", error);
                    setIsLoading(false);
                });
            }
        }
        
        return () => {
            cancelled = true;
            unsubSessions();
            if (unsubscribeDailyMetrics) {
                unsubscribeDailyMetrics();
            }
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

    // Data Sanity Checks and Warnings
    const warnings: string[] = [];
    const net = stats.netSales ?? 0;
    const tx = stats.transactions ?? 0;

    if (!ytdMode && differenceInDays(dateRange.end, dateRange.start) > MAX_DAYS_RANGE) {
        warnings.push(`Date range is too large (${differenceInDays(dateRange.end, dateRange.start)} days). Please select a range of ${MAX_DAYS_RANGE} days or less, or use the YTD view.`);
    }

    if (tx > 0 && net === 0) warnings.push("Transactions > 0 but Net Sales is 0 (possible rollup issue).");
    if (tx > 0 && stats.avgBasket === 0) warnings.push("Avg Basket is 0 while Transactions > 0.");
    
    const mopSum = Object.values(paymentMix || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    const diff = Math.abs(mopSum - net);
    if (tx > 0 && diff > 2) warnings.push(`Payment mix mismatch vs Net Sales (diff ₱${diff.toFixed(2)}).`);

    return {
        isLoading,
        dateRangeLabel,
        dateRange,
        stats,
        activeSessions,
        paymentMix,
        dailyMetrics,
        topCategories,
        ytdData,
        trendRows,
        warnings
    };
}
