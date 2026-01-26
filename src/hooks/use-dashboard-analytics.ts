

"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, doc, getDoc, query, where, getDocs, onSnapshot, limit, orderBy, type DocumentReference } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { DailyMetric } from "@/lib/types";
import { mergeWith } from "lodash";
import { differenceInDays, addDays } from 'date-fns';

export type DatePreset = "today" | "yesterday" | "week" | "month" | "last7" | "last30" | "lastMonth" | "ytd" | "custom";
export type DashboardStats = { netSales: number; transactions: number; avgBasket: number; };
export type YtdTally = DashboardStats & { mop: Record<string, number> };
export type TrendRow = { month: number, curGross: number, prevGross: number, curTx: number, prevTx: number };
type AddonAgg = { itemName: string; categoryName: string; qty: number; amount: number };

const NULL_YTD_TALLY: YtdTally = { netSales: 0, transactions: 0, avgBasket: 0, mop: {} };

// --- Date Helpers ---
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function isSameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtDate(d: Date) { return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }); }

// --- Data Fetching Helpers ---
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

function mergeAddonAgg(target: Map<string, AddonAgg>, row: any) {
  const key = row.itemName;
  const cur = target.get(key) ?? { itemName: row.itemName, categoryName: row.categoryName ?? "Uncategorized", qty: 0, amount: 0 };
  cur.qty += row.qty ?? 0;
  cur.amount += row.amount ?? 0;
  if (!cur.categoryName && row.categoryName) cur.categoryName = row.categoryName;
  target.set(key, cur);
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

const presetIdMap: Partial<Record<DatePreset, string>> = {
    today: "today",
    yesterday: "yesterday",
    last7: "last7",
    week: "last7", // alias 'week' to 'last7'
    last30: "last30",
    month: "thisMonth",
    lastMonth: "lastMonth",
    ytd: "ytd",
};

const presetCache = new Map<string, { data: DailyMetric; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute


interface UseDashboardAnalyticsProps {
    storeId?: string | null;
    preset: DatePreset;
    customRange: { start: Date; end: Date } | null;
}

const MAX_DAYS_RANGE = 90;

export function useDashboardAnalytics({ storeId, preset, customRange }: UseDashboardAnalyticsProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
    const [topCategories, setTopCategories] = useState<ReturnType<typeof groupByCategory>>([]);
    const [activeSessions, setActiveSessions] = useState({ count: 0, guests: 0 });
    
    const dateRange = useMemo(() => {
        const now = new Date();
        let s = startOfDay(now), e = endOfDay(now);
        switch (preset) {
            case "today": break;
            case "yesterday": s = startOfDay(addDays(now, -1)); e = endOfDay(s); break;
            case "week": s = startOfDay(addDays(now, -now.getDay())); break; // Start of this week (Sunday)
            case "last7": s = startOfDay(addDays(now, -6)); break;
            case "last30": s = startOfDay(addDays(now, -29)); break;
            case "month": s = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)); break;
            case "lastMonth": 
                s = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
                e = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
                break;
            case "ytd": s = startOfDay(new Date(now.getFullYear(), 0, 1)); break;
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

        const sessionsRef = collection(db, "stores", storeId, "sessions");
        const activeSessionsQuery = query(sessionsRef, where("status", "in", ["active", "pending_verification"]));
        const unsubSessions = onSnapshot(activeSessionsQuery, (snapshot) => {
            if (cancelled) return;
            let totalGuests = 0;
            snapshot.forEach(doc => {
                const data = doc.data();
                totalGuests += Number(data.guestCountFinal ?? data.guestCountServerVerified ?? data.guestCountCashierInitial ?? 0);
            });
            setActiveSessions({ count: snapshot.size, guests: totalGuests });
        });

        async function fetchAndProcessData() {
            const presetId = presetIdMap[preset];
            
            if (presetId) {
                const cacheKey = `${storeId}:${presetId}`;
                const cached = presetCache.get(cacheKey);
                if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
                    console.log(`[useDashboardAnalytics] Using CACHED preset for: ${presetId}`);
                    const presetData = cached.data;
                    setDailyMetrics([]); // Clear daily metrics to disable dependent cards
                    const categories = groupByCategory(Object.values(presetData.sales?.addonSalesByItem || {}));
                    setTopCategories(categories);
                    setIsLoading(false);
                    return;
                }

                const presetDocRef = doc(db, `stores/${storeId}/dashPresets`, presetId);
                const presetSnap = await getDoc(presetDocRef);
                if (presetSnap.exists()) {
                    console.log(`[useDashboardAnalytics] Using PRESET DOC for: ${presetId}`);
                    const presetData = presetSnap.data() as DailyMetric;
                    setDailyMetrics([presetData]); // Set as single aggregated doc
                    const categories = groupByCategory(Object.values(presetData.sales?.addonSalesByItem || {}));
                    setTopCategories(categories);
                    presetCache.set(cacheKey, { data: presetData, timestamp: Date.now() });
                    setIsLoading(false);
                    return;
                } else {
                    console.log(`[useDashboardAnalytics] Preset doc not found for ${presetId}, using fallback.`);
                }
            }
            
            // --- FALLBACK LOGIC ---
            if (differenceInDays(dateRange.end, dateRange.start) > MAX_DAYS_RANGE) {
                 setDailyMetrics([]);
                 setTopCategories([]);
            } else {
                const tomorrow = addDays(dateRange.end, 1);
                const q = query(
                    collection(db, "stores", storeId, "analytics"),
                    where("meta.dayStartMs", ">=", dateRange.start.getTime()),
                    where("meta.dayStartMs", "<", startOfDay(tomorrow).getTime())
                );
                
                const snapshot = await getDocs(q);
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
            }
        }
        
        fetchAndProcessData().finally(() => {
            if (!cancelled) setIsLoading(false);
        });
        
        return () => {
            cancelled = true;
            unsubSessions();
        };
    }, [storeId, dateRange.start, dateRange.end, preset]);
    
    const aggregatedData = useMemo(() => aggregateDailies(dailyMetrics), [dailyMetrics]);

    const stats = useMemo<DashboardStats>(() => aggregatedData, [aggregatedData]);
    const paymentMix = useMemo<Record<string, number>>(() => aggregatedData.mop, [aggregatedData]);

    const dateRangeLabel = useMemo(() => {
        return isSameDay(dateRange.start, dateRange.end) ? fmtDate(dateRange.start) : `${fmtDate(dateRange.start)} - ${fmtDate(dateRange.end)}`;
    }, [dateRange.start, dateRange.end]);

    const warnings: string[] = [];
    if (preset === 'custom' && differenceInDays(dateRange.end, dateRange.start) > MAX_DAYS_RANGE) {
        warnings.push(`Date range is too large (${differenceInDays(dateRange.end, dateRange.start)} days). Please select a range of ${MAX_DAYS_RANGE} days or less.`);
    }
    
    const mopSum = Object.values(paymentMix || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    const diff = Math.abs(mopSum - stats.netSales);
    if (stats.transactions > 0 && diff > 2) warnings.push(`Payment mix mismatch vs Net Sales (diff ₱${diff.toFixed(2)}).`);

    return {
        isLoading,
        dateRangeLabel,
        dateRange,
        stats,
        activeSessions,
        paymentMix,
        dailyMetrics,
        topCategories,
        warnings
    };
}
