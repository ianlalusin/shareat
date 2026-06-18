// Pure, SDK-agnostic aggregation core for analytics backfill. No firebase
// imports — safe to run under the admin SDK (server endpoint) and reusable. The
// client backfill.ts keeps its own inline copy (it is also applyAnalyticsDeltaV2's
// last-resort fallback); this core is what the SERVER backfill uses, so both the
// daily rebuild and preset/rollup rebuilds run server-side without duplicating
// the contribution math beyond what daily.ts already centralizes.

import type { DailyMetric, Receipt, ReceiptAnalyticsV2, KitchenTicket, Store } from "@/lib/types";
import {
  getDayIdFromTimestamp,
  getDayStartMs,
  getPaymentContribution,
  getGuestCoversContribution,
  getSalesContribution,
  getPeakHourContribution,
  getRefillContribution,
  getClosedSessionsContribution,
  getKitchenTicketContribution,
  getItemAdjustmentContribution,
  getDayOfWeekContribution,
} from "./daily";
import { toJsDate, startOfDay, endOfDay } from "@/lib/utils/date";

const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

/**
 * Fix payment mix for historical receipts (old style: cash includes change).
 * Only subtracts change from cash when the receipt "looks old", to avoid
 * double-subtracting on new-style receipts.
 */
export function correctedByMethodForReceipt(receipt: Receipt, byMethodIn: Record<string, number>) {
  const byMethod = { ...(byMethodIn || {}) };
  const analytics = (receipt.analytics || {}) as ReceiptAnalyticsV2;
  const change = Number(receipt.change ?? (analytics as any)?.change ?? 0);
  if (!(change > 0)) return byMethod;

  const sumMop = Object.values(byMethod).reduce((s, v) => s + Number(v || 0), 0);
  const totalPaid = Number((analytics as any)?.totalPaid ?? (receipt as any)?.totalPaid ?? 0);
  const grandTotal = Number((analytics as any)?.grandTotal ?? receipt.total ?? 0);

  const looksOld =
    totalPaid > 0 ? near(sumMop, totalPaid) && !near(sumMop, grandTotal) : sumMop > grandTotal + 0.01;
  if (!looksOld) return byMethod;

  const cashKey =
    Object.keys(byMethod).find((k) => k.toLowerCase().includes("cash")) ??
    Object.entries(byMethod).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0]?.[0];
  if (!cashKey) return byMethod;

  byMethod[cashKey] = Math.max(0, Number(byMethod[cashKey] || 0) - change);
  return byMethod;
}

export type AggregateParams = {
  receipts: Receipt[];
  tickets: KitchenTicket[];
  verifiedSessions: any[];
  store: Store;
  storeId: string;
  startInclusiveMs: number;
  endExclusiveMs: number;
};

/**
 * Aggregate receipts + kitchen tickets + verified sessions into per-day
 * DailyMetric docs. The returned docs carry meta {dayId, dayStartMs, storeId};
 * the caller stamps meta.updatedAt / backfilledAt / source with its SDK before
 * writing. Faithful port of backfill.ts's aggregation (minus IO + serverTimestamp).
 */
export function aggregateDailyMetrics(params: AggregateParams): Map<string, DailyMetric> {
  const { receipts, tickets, verifiedSessions, store, storeId, startInclusiveMs, endExclusiveMs } = params;
  const dailyAggregates = new Map<string, DailyMetric>();

  const ensureDay = (dayId: string, dayStartMs: number) => {
    if (!dailyAggregates.has(dayId)) {
      dailyAggregates.set(dayId, {
        meta: { dayId, dayStartMs, storeId } as any,
        payments: { byMethod: {}, totalGross: 0, txCount: 0, discountsTotal: 0, chargesTotal: 0, txCountByMode: { dineIn: 0, walkIn: 0 } },
        guests: { guestCountFinalTotal: 0, packageCoversBilledByPackageName: {}, packageSessionsCount: 0, guestCountFinalByPackageName: {} },
        sales: {
          packageSalesAmountByName: {}, packageSalesQtyByName: {}, addonSalesAmountByCategory: {}, addonSalesQtyByCategory: {}, addonSalesByItem: {},
          dineInAddonSalesAmount: 0, dineInSalesGross: 0, dineInDiscountsTotal: 0, dineInChargesTotal: 0,
          salesAmountByHour: {}, sessionCountByHour: {}, salesAmountByHourByMode: { dineIn: {}, walkIn: {} }, sessionCountByHourByMode: { dineIn: {}, walkIn: {} },
          salesAmountByMode: { dineIn: 0, walkIn: 0 }, netSalesByMode: { dineIn: 0, walkIn: 0 }, salesAmountByDow: {}, sessionCountByDow: {},
        },
        kitchen: { servedCountByType: {}, cancelledCountByType: {}, durationMsSumByType: {}, durationCountByType: {}, durationMsSumByLocation: {}, durationCountByLocation: {}, servingMsSumByUser: {}, servingCountByUser: {} },
        sessions: { closedCount: 0, totalPaid: 0, closedCountByMode: { dineIn: 0, walkIn: 0 }, dineInDurationMsSum: 0, dineInDurationCount: 0 },
        server: { confirmMsSum: 0, confirmCount: 0, confirmMsSumByUser: {}, confirmCountByUser: {} },
        staffNames: {},
        refills: { servedRefillsTotal: 0, servedRefillsByName: {}, packageSessionsCount: 0 },
        items: { voidedQty: 0, voidedAmount: 0, freeQty: 0, freeAmount: 0, discountedQty: 0, discountedAmount: 0, refundCount: 0, refundTotal: 0 },
      } as DailyMetric);
    }
    return dailyAggregates.get(dayId)!;
  };

  // --- aggregate receipts ---
  for (const receipt of receipts) {
    if (!receipt || receipt.status === "voided") continue;
    const eventMs = receipt.createdAtClientMs || toJsDate((receipt as any).createdAt)?.getTime();
    if (!eventMs) continue;

    const dayId = getDayIdFromTimestamp(eventMs);
    const dayStartMs = getDayStartMs(eventMs);
    const dayData = ensureDay(dayId, dayStartMs);

    const paymentContrib = getPaymentContribution(receipt);
    const fixedByMethod = correctedByMethodForReceipt(receipt, (paymentContrib.byMethod || {}) as any);
    const guestContrib = getGuestCoversContribution(receipt);
    const salesContrib = getSalesContribution(receipt, store);
    const peakHourContrib = getPeakHourContribution(receipt);
    const closedSessionContrib = getClosedSessionsContribution(receipt);
    const refillContrib = getRefillContribution(receipt);
    const dowContrib = getDayOfWeekContribution(receipt);

    dayData.payments!.totalGross = (dayData.payments!.totalGross || 0) + Number(paymentContrib.totalGross || 0);
    dayData.payments!.txCount = (dayData.payments!.txCount || 0) + Number(paymentContrib.txCount || 0);
    dayData.payments!.discountsTotal = (dayData.payments!.discountsTotal || 0) + Number(paymentContrib.discountsTotal || 0);
    dayData.payments!.chargesTotal = (dayData.payments!.chargesTotal || 0) + Number(paymentContrib.chargesTotal || 0);
    if (paymentContrib.mode && paymentContrib.txCount > 0) {
      dayData.payments!.txCountByMode ??= { dineIn: 0, walkIn: 0 };
      dayData.payments!.txCountByMode[paymentContrib.mode] += paymentContrib.txCount;
    }
    for (const [method, amount] of Object.entries(fixedByMethod)) {
      dayData.payments!.byMethod[method] = (dayData.payments!.byMethod[method] || 0) + Number(amount || 0);
    }

    dayData.guests ??= { guestCountFinalTotal: 0, packageCoversBilledByPackageName: {}, packageSessionsCount: 0, guestCountFinalByPackageName: {} } as any;
    dayData.guests!.guestCountFinalByPackageName ??= {};
    dayData.guests!.packageCoversBilledByPackageName ??= {};
    dayData.guests!.guestCountFinalTotal = (dayData.guests!.guestCountFinalTotal || 0) + Number(guestContrib.guestCountFinal || 0);
    dayData.guests!.packageSessionsCount = (dayData.guests!.packageSessionsCount || 0) + Number(guestContrib.packageSessionsCount || 0);
    for (const [pkgName, count] of Object.entries(guestContrib.guestCountFinalByPackageName || {})) {
      dayData.guests!.guestCountFinalByPackageName[pkgName] = (dayData.guests!.guestCountFinalByPackageName[pkgName] || 0) + Number(count || 0);
    }
    for (const [pkgName, count] of Object.entries(guestContrib.packageCoversBilledByPackageName || {})) {
      dayData.guests!.packageCoversBilledByPackageName[pkgName] = (dayData.guests!.packageCoversBilledByPackageName[pkgName] || 0) + Number(count || 0);
    }

    dayData.sales ??= { packageSalesAmountByName: {}, packageSalesQtyByName: {}, addonSalesAmountByCategory: {}, addonSalesQtyByCategory: {}, addonSalesByItem: {}, salesAmountByHour: {}, sessionCountByHour: {} } as any;
    dayData.sales!.dineInAddonSalesAmount = (dayData.sales!.dineInAddonSalesAmount || 0) + Number(salesContrib.dineInAddonSalesAmount || 0);
    dayData.sales!.dineInSalesGross = (dayData.sales!.dineInSalesGross || 0) + Number(salesContrib.dineInSalesGross || 0);
    dayData.sales!.dineInDiscountsTotal = (dayData.sales!.dineInDiscountsTotal || 0) + Number(salesContrib.dineInDiscountsTotal || 0);
    dayData.sales!.dineInChargesTotal = (dayData.sales!.dineInChargesTotal || 0) + Number(salesContrib.dineInChargesTotal || 0);
    if (salesContrib.mode) {
      dayData.sales!.salesAmountByMode ??= { dineIn: 0, walkIn: 0 };
      dayData.sales!.netSalesByMode ??= { dineIn: 0, walkIn: 0 };
      dayData.sales!.salesAmountByMode[salesContrib.mode] += Number(salesContrib.salesGrossByMode?.[salesContrib.mode] || 0);
      dayData.sales!.netSalesByMode[salesContrib.mode] += Number(salesContrib.netSalesByMode?.[salesContrib.mode] || 0);
    }
    for (const [pkgName, amount] of Object.entries(salesContrib.packageSalesAmountByName || {})) {
      dayData.sales!.packageSalesAmountByName[pkgName] = (dayData.sales!.packageSalesAmountByName[pkgName] || 0) + Number(amount || 0);
    }
    for (const [pkgName, qty] of Object.entries(salesContrib.packageSalesQtyByName || {})) {
      dayData.sales!.packageSalesQtyByName[pkgName] = (dayData.sales!.packageSalesQtyByName[pkgName] || 0) + Number(qty || 0);
    }
    for (const [catName, amount] of Object.entries(salesContrib.addonSalesAmountByCategory || {})) {
      dayData.sales!.addonSalesAmountByCategory[catName] = (dayData.sales!.addonSalesAmountByCategory[catName] || 0) + Number(amount || 0);
    }
    for (const [catName, qty] of Object.entries(salesContrib.addonSalesQtyByCategory || {})) {
      dayData.sales!.addonSalesQtyByCategory[catName] = (dayData.sales!.addonSalesQtyByCategory[catName] || 0) + Number(qty || 0);
    }
    for (const [itemName, itemData] of Object.entries(salesContrib.addonSalesByItem || {})) {
      dayData.sales!.addonSalesByItem ??= {};
      if (!dayData.sales!.addonSalesByItem[itemName]) {
        dayData.sales!.addonSalesByItem[itemName] = { qty: 0, amount: 0, categoryName: (itemData as any).categoryName };
      }
      dayData.sales!.addonSalesByItem[itemName].qty += (itemData as any).qty;
      dayData.sales!.addonSalesByItem[itemName].amount += (itemData as any).amount;
    }

    if (peakHourContrib.hourKey) {
      dayData.sales!.salesAmountByHour[peakHourContrib.hourKey] = (dayData.sales!.salesAmountByHour[peakHourContrib.hourKey] || 0) + Number(peakHourContrib.amount || 0);
      dayData.sales!.sessionCountByHour[peakHourContrib.hourKey] = (dayData.sales!.sessionCountByHour[peakHourContrib.hourKey] || 0) + Number(peakHourContrib.count || 0);
      if (peakHourContrib.mode) {
        dayData.sales!.salesAmountByHourByMode ??= { dineIn: {}, walkIn: {} };
        dayData.sales!.sessionCountByHourByMode ??= { dineIn: {}, walkIn: {} };
        const m = peakHourContrib.mode;
        const hk = peakHourContrib.hourKey;
        dayData.sales!.salesAmountByHourByMode[m][hk] = (dayData.sales!.salesAmountByHourByMode[m][hk] || 0) + Number(peakHourContrib.amount || 0);
        dayData.sales!.sessionCountByHourByMode[m][hk] = (dayData.sales!.sessionCountByHourByMode[m][hk] || 0) + Number(peakHourContrib.count || 0);
      }
    }

    if (dowContrib.dowKey) {
      dayData.sales!.salesAmountByDow ??= {};
      dayData.sales!.sessionCountByDow ??= {};
      dayData.sales!.salesAmountByDow[dowContrib.dowKey] = (dayData.sales!.salesAmountByDow[dowContrib.dowKey] || 0) + Number(dowContrib.amount || 0);
      dayData.sales!.sessionCountByDow[dowContrib.dowKey] = (dayData.sales!.sessionCountByDow[dowContrib.dowKey] || 0) + Number(dowContrib.count || 0);
    }

    dayData.sessions!.closedCount = (dayData.sessions!.closedCount || 0) + Number(closedSessionContrib.closedCount || 0);
    dayData.sessions!.totalPaid = (dayData.sessions!.totalPaid || 0) + Number(closedSessionContrib.totalPaid || 0);
    if (closedSessionContrib.mode && closedSessionContrib.closedCount > 0) {
      dayData.sessions!.closedCountByMode ??= { dineIn: 0, walkIn: 0 };
      dayData.sessions!.closedCountByMode[closedSessionContrib.mode] += closedSessionContrib.closedCount;
    }
    dayData.sessions!.dineInDurationMsSum = (dayData.sessions!.dineInDurationMsSum || 0) + Number(closedSessionContrib.dineInDurationMs || 0);
    dayData.sessions!.dineInDurationCount = (dayData.sessions!.dineInDurationCount || 0) + Number(closedSessionContrib.dineInDurationCount || 0);

    dayData.refills!.packageSessionsCount = (dayData.refills!.packageSessionsCount || 0) + Number(refillContrib.packageSessionsCount || 0);
    dayData.refills!.servedRefillsTotal = (dayData.refills!.servedRefillsTotal || 0) + Number(refillContrib.servedRefillsTotal || 0);
    for (const [refillName, qty] of Object.entries(refillContrib.servedRefillsByName || {})) {
      dayData.refills!.servedRefillsByName[refillName] = (dayData.refills!.servedRefillsByName[refillName] || 0) + Number(qty || 0);
    }

    const adjContrib = getItemAdjustmentContribution(receipt);
    const items = ((dayData as any).items ??= { voidedQty: 0, voidedAmount: 0, freeQty: 0, freeAmount: 0, discountedQty: 0, discountedAmount: 0, refundCount: 0, refundTotal: 0 });
    items.voidedQty += adjContrib.voidedQty;
    items.voidedAmount += adjContrib.voidedAmount;
    items.freeQty += adjContrib.freeQty;
    items.freeAmount += adjContrib.freeAmount;
    items.discountedQty += adjContrib.discountedQty;
    items.discountedAmount += adjContrib.discountedAmount;
    items.refundCount += adjContrib.refundCount;
    items.refundTotal += adjContrib.refundTotal;
  }

  // --- aggregate kitchen tickets ---
  for (const ticket of tickets) {
    const kitchenContrib = getKitchenTicketContribution(ticket);
    if (!kitchenContrib.dayId) continue;
    if (kitchenContrib.dayStartMs < startInclusiveMs || kitchenContrib.dayStartMs >= endExclusiveMs) continue;

    const dayData = ensureDay(kitchenContrib.dayId, kitchenContrib.dayStartMs);
    const typeKey = kitchenContrib.typeKey;
    dayData.kitchen!.servedCountByType[typeKey] = (dayData.kitchen!.servedCountByType[typeKey] || 0) + Number(kitchenContrib.servedCount || 0);
    dayData.kitchen!.cancelledCountByType[typeKey] = (dayData.kitchen!.cancelledCountByType[typeKey] || 0) + Number(kitchenContrib.cancelledCount || 0);
    dayData.kitchen!.durationMsSumByType[typeKey] = (dayData.kitchen!.durationMsSumByType[typeKey] || 0) + Number(kitchenContrib.durationMsSum || 0);
    dayData.kitchen!.durationCountByType[typeKey] = (dayData.kitchen!.durationCountByType[typeKey] || 0) + Number(kitchenContrib.durationCount || 0);

    if (ticket.status === "served") {
      const dur = Number(ticket.durationMs ?? 0);
      const locationId = ticket.kitchenLocationId;
      if (locationId) {
        const qty = Number(ticket.qty ?? 1);
        dayData.kitchen!.durationMsSumByLocation![locationId] = (dayData.kitchen!.durationMsSumByLocation![locationId] || 0) + (dur > 0 ? dur : 0);
        dayData.kitchen!.durationCountByLocation![locationId] = (dayData.kitchen!.durationCountByLocation![locationId] || 0) + qty;
      }
      // Trim/guard so a blank or whitespace profile id never creates an
      // unlabeled per-user bucket (renders as an empty row in reports).
      const pid = String((ticket as any).servedByProfileId || "").trim();
      if (pid && dur > 0) {
        dayData.kitchen!.servingMsSumByUser![pid] = (dayData.kitchen!.servingMsSumByUser![pid] || 0) + dur;
        dayData.kitchen!.servingCountByUser![pid] = (dayData.kitchen!.servingCountByUser![pid] || 0) + 1;
        const pname = String((ticket as any).servedByProfileName || "").trim();
        if (pname) (dayData as any).staffNames[pid] = pname;
      }
    }
  }

  // --- aggregate server confirmations ---
  for (const s of verifiedSessions) {
    const verifyMs = Number(s.verifyDurationMs ?? 0);
    if (!(verifyMs > 0)) continue;
    const verifiedMs = toJsDate(s.verifiedAt)?.getTime();
    if (!verifiedMs) continue;
    const dayStartMs = getDayStartMs(verifiedMs);
    if (dayStartMs < startInclusiveMs || dayStartMs >= endExclusiveMs) continue;
    const dayData = ensureDay(getDayIdFromTimestamp(verifiedMs), dayStartMs);
    const srv = dayData.server!;
    srv.confirmMsSum = (srv.confirmMsSum || 0) + verifyMs;
    srv.confirmCount = (srv.confirmCount || 0) + 1;
    const pid = String(s.verifiedByServerProfileId || "").trim();
    if (pid) {
      srv.confirmMsSumByUser![pid] = (srv.confirmMsSumByUser![pid] || 0) + verifyMs;
      srv.confirmCountByUser![pid] = (srv.confirmCountByUser![pid] || 0) + 1;
      const pname = String(s.verifiedByServerProfileName || "").trim();
      if (pname) (dayData as any).staffNames[pid] = pname;
    }
  }

  return dailyAggregates;
}

// Deep-sums numeric fields of `src` into `target`, recursing into nested maps.
// Skips `meta` and arrays. Used by the preset rebuild.
export function sumDailyBodyInto(target: any, src: any) {
  for (const key of Object.keys(src)) {
    if (key === "meta") continue;
    const sv = src[key];
    if (sv == null) continue;
    if (typeof sv === "number") {
      target[key] = (typeof target[key] === "number" ? target[key] : 0) + sv;
    } else if (Array.isArray(sv)) {
      continue;
    } else if (typeof sv === "object") {
      if (typeof target[key] !== "object" || target[key] == null || Array.isArray(target[key])) target[key] = {};
      sumDailyBodyInto(target[key], sv);
    }
  }
}

export function topRefillsFrom(agg: any, topN = 10) {
  const m = (agg?.refills?.servedRefillsByName ?? {}) as Record<string, number>;
  return Object.entries(m).map(([name, qty]) => ({ name, qty: Number(qty) || 0 })).sort((a, b) => b.qty - a.qty).slice(0, topN);
}

export function topAddonsFrom(agg: any, topN = 10) {
  const m = (agg?.sales?.addonSalesByItem ?? {}) as Record<string, any>;
  return Object.entries(m)
    .map(([name, d]) => ({ name, qty: Number(d?.qty) || 0, amount: Number(d?.amount) || 0, categoryName: d?.categoryName || "Uncategorized" }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, topN);
}

/** The 8 dashboard preset windows, matching backfill.ts/rebuildDashboardPresets. */
export function presetRanges(now: Date): { presetId: string; start: Date; end: Date }[] {
  const addDaysLocal = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  return [
    { presetId: "today", start: startOfDay(now), end: endOfDay(now) },
    { presetId: "yesterday", start: startOfDay(addDaysLocal(now, -1)), end: endOfDay(addDaysLocal(now, -1)) },
    { presetId: "thisWeek", start: startOfDay(addDaysLocal(now, -now.getDay())), end: endOfDay(now) },
    { presetId: "last7", start: startOfDay(addDaysLocal(now, -6)), end: endOfDay(now) },
    { presetId: "last30", start: startOfDay(addDaysLocal(now, -29)), end: endOfDay(now) },
    { presetId: "thisMonth", start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), end: endOfDay(now) },
    { presetId: "lastMonth", start: startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)) },
    { presetId: "ytd", start: startOfDay(new Date(now.getFullYear(), 0, 1)), end: endOfDay(now) },
  ];
}
