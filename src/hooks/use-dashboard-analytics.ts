
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, doc, getDoc, query, where, getDocs, onSnapshot, limit, orderBy, type DocumentReference } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { DailyMetric } from "@/lib/types";
import { differenceInDays, addDays } from 'date-fns';
import { startOfDay, endOfDay, isSameDay, fmtDate } from '@/lib/utils/date';

export type DatePreset = "today" | "yesterday" | "week" | "month" | "last7" | "last30" | "lastMonth" | "ytd" | "custom";
export type DashboardStats = { netSales: number; transactions: number; avgBasket: number; };
export type YtdTally = DashboardStats & { mop: Record<string, number> };
export type TrendRow = { month: number, curGross: number, prevGross: number, curTx: number, prevTx: number };
export type TopRefillRow = { name: string; qty: number };
export type TopAddonRow = { name: string; qty: number; amount: number; categoryName: string; };

const NULL_YTD_TALLY: YtdTally = { netSales: 0, transactions: 0, avgBasket: 0, mop: {} };

// --- Data Aggregation Helpers ---
function aggregateAddonCategories(metrics: DailyMetric[]): { categoryName: string; qty: number; amount: number }[] {
  const categoryMap: Record<string, { qty: number; amount: number }> = {};

  metrics.forEach(metric => {
    const amounts = metric.sales?.addonSalesAmountByCategory || {};
    const quantities = (metric.sales as any)?.addonSalesQtyByCategory || {}; // Use as any for compatibility if not typed yet
    
    const allCategoryNames = new Set([...Object.keys(amounts), ...Object.keys(quantities)]);

    allCategoryNames.forEach(categoryName => {
      if (!categoryMap[categoryName]) {
        categoryMap[categoryName] = { qty: 0, amount: 0 };
      }
      categoryMap[categoryName].amount += amounts[categoryName] || 0;
      categoryMap[categoryName].qty += quantities[categoryName] || 0;
    });
  });

  return Object.entries(categoryMap)
    .map(([categoryName, data]) => ({
      categoryName,
      ...data,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function aggregateDailies(dailyMetrics: DailyMetric[]): YtdTally {
    const netSales = dailyMetrics.reduce((sum, metric) => sum + (metric.payments?.totalGross || 0), 0);
    const transactions = dailyMetrics.reduce((sum, metric) => sum + (metric.payments?.txCount || 0), 0);
    
    const totalDineInSalesGross = dailyMetrics.reduce((sum, metric) => sum + (metric.sales?.dineInSalesGross || 0), 0);
    const totalDineInDiscounts = dailyMetrics.reduce((sum, metric) => sum + (metric.sales?.dineInDiscountsTotal || 0), 0);
    const totalDineInCharges = dailyMetrics.reduce((sum, metric) => sum + (metric.sales?.dineInChargesTotal || 0), 0);
    const totalDineInNet = totalDineInSalesGross - totalDineInDiscounts - totalDineInCharges;
    const totalDineInGuests = dailyMetrics.reduce((sum, metric) => sum + (metric.guests?.guestCountFinalTotal || 0), 0);
    const avgSpending = totalDineInGuests > 0 ? totalDineInNet / totalDineInGuests : 0;
    
    const mop: Record<string, number> = {};
    dailyMetrics.forEach(metric => {
        const methods = metric.payments?.byMethod ?? {};
        for (const [method, amount] of Object.entries(methods)) {
            mop[method] = (mop[method] || 0) + amount;
        }
    });
    return { netSales, transactions, avgBasket: avgSpending, mop };
}

function aggregateRefills(metrics: DailyMetric[], topN: number = 5): TopRefillRow[] {
  const tally: Record<string, number> = {};
  metrics.forEach(metric => {
    const refillsByName = metric.refills?.servedRefillsByName || {};
    for (const [name, qty] of Object.entries(refillsByName)) {
      tally[name] = (tally[name] || 0) + qty;
    }
  });
  return Object.entries(tally)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, topN);
}

function aggregateTopAddons(metrics: DailyMetric[]): TopAddonRow[] {
  const itemMap: Record<string, TopAddonRow> = {};

  metrics.forEach(metric => {
    // Use the explicit addonSalesByItem field
    const items = (metric.sales as any)?.addonSalesByItem || {};
    for (const [name, data] of Object.entries(items as Record<string, any>)) {
      if (!itemMap[name]) {
        itemMap[name] = { name, qty: 0, amount: 0, categoryName: data.categoryName || 'Uncategorized' };
      }
      itemMap[name].qty += data.qty || 0;
      itemMap[name].amount += data.amount || 0;
    }
  });

  return Object.values(itemMap).sort((a, b) => b.amount - a.amount);
}


const presetIdMap: Partial<Record<DatePreset, string>> = {
    today: "today",
    yesterday: "yesterday",
    last7: "last7",
    week: "thisWeek",
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
    const [topCategories, setTopCategories] = useState<ReturnType<typeof aggregateAddonCategories>>([]);
    const [activeSessions, setActiveSessions] = useState({ count: 0, guests: 0 });
    const [topRefills, setTopRefills] = useState<TopRefillRow[]>([]);
    const [topAddonItems, setTopAddonItems] = useState<TopAddonRow[]>([]);
    const [hasTopAddonItems, setHasTopAddonItems] = useState(false);
    
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
            setTopCategories([]);
            setTopRefills([]);
            setTopAddonItems([]);
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
            if (!storeId) { // Redundant guard for TS narrowing inside async function
                setIsLoading(false);
                return;
            }
            const presetId = presetIdMap[preset];
            
            if (presetId) {
                const cacheKey = `${storeId}:${presetId}`;
                const cached = presetCache.get(cacheKey);

                const validateAndUse = (data: DailyMetric) => {
                    const meta = data.meta as any;
                    const isRangeValid = meta?.rangeStartMs === dateRange.start.getTime() && meta?.rangeEndMs === dateRange.end.getTime();

                    if (!isRangeValid) return false;

                    setDailyMetrics([data]);
                    setTopCategories(aggregateAddonCategories([data]));
                    
                    const servedRefillsExist = data.refills?.servedRefillsByName && Object.keys(data.refills.servedRefillsByName).length > 0;
                    const newTopRefills = servedRefillsExist
                        ? aggregateRefills([data])
                        : (data as any).refills?.topRefillsByQty ?? [];
                    setTopRefills(newTopRefills);

                    setTopAddonItems((data as any).sales?.topAddonsByQty ?? []);
                    setHasTopAddonItems(!!(data as any).sales?.topAddonsByQty);
                    
                    return true;
                }

                if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
                    if (validateAndUse(cached.data)) {
                        // console.log(`[useDashboardAnalytics] Using MEMORY CACHE for: ${presetId}`);
                        setIsLoading(false);
                        return;
                    } else {
                        // console.warn(`[useDashboardAnalytics] Stale memory cache for ${presetId}. Refetching.`);
                        presetCache.delete(cacheKey); // Evict stale cache
                    }
                }

                const presetDocRef = doc(db, `stores/${storeId}/dashPresets`, presetId);
                const presetSnap = await getDoc(presetDocRef);
                if (presetSnap.exists()) {
                    const presetData = presetSnap.data() as DailyMetric;
                    if (validateAndUse(presetData)) {
                        // console.log(`[useDashboardAnalytics] Using PRESET DOC for: ${presetId}`);
                        presetCache.set(cacheKey, { data: presetData, timestamp: Date.now() });
                        setIsLoading(false);
                        return;
                    } else {
                         // console.warn(`[useDashboardAnalytics] Stale preset doc found for ${presetId}. Falling back to query.`);
                    }
                } else {
                    // console.log(`[useDashboardAnalytics] Preset doc not found for ${presetId}, using fallback.`);
                }
            }
            
            // --- FALLBACK LOGIC ---
            if (differenceInDays(dateRange.end, dateRange.start) > MAX_DAYS_RANGE) {
                 setDailyMetrics([]);
                 setTopCategories([]);
                 setTopRefills([]);
                 setTopAddonItems([]);
                 setHasTopAddonItems(false);
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
                const aggregatedAddons = aggregateTopAddons(metrics);
                
                setDailyMetrics(metrics);
                setTopCategories(aggregateAddonCategories(metrics));
                setTopRefills(aggregateRefills(metrics));
                setTopAddonItems(aggregatedAddons);
                setHasTopAddonItems(aggregatedAddons.length > 0);
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
        warnings,
        topRefills,
        topAddonItems,
        hasTopAddonItems
    };
}

    