// Pure, SDK-agnostic analytics delta math. No firebase imports — safe to run on
// the server (admin SDK) and unit-testable. The client writer
// (applyAnalyticsDeltaV2.ts) keeps its own inline copy for now; it is slated for
// removal once the payment flow is switched to the server endpoint (Stage B).

import type { Receipt } from "@/lib/types";
import {
  getPaymentContribution,
  getGuestCoversContribution,
  getSalesContribution,
  getPeakHourContribution,
  getRefillContribution,
  getClosedSessionsContribution,
  getItemAdjustmentContribution,
  getDayOfWeekContribution,
} from "@/lib/analytics/daily";

export type ContributionSet = {
  payment: ReturnType<typeof getPaymentContribution>;
  guest: ReturnType<typeof getGuestCoversContribution>;
  sales: ReturnType<typeof getSalesContribution>;
  peak: ReturnType<typeof getPeakHourContribution>;
  refill: ReturnType<typeof getRefillContribution>;
  closed: ReturnType<typeof getClosedSessionsContribution>;
  itemAdj: ReturnType<typeof getItemAdjustmentContribution>;
  dow: ReturnType<typeof getDayOfWeekContribution>;
};

export function getContributions(receipt: Receipt | null): ContributionSet {
  return {
    payment: getPaymentContribution(receipt),
    guest: getGuestCoversContribution(receipt),
    sales: getSalesContribution(receipt),
    peak: getPeakHourContribution(receipt),
    refill: getRefillContribution(receipt),
    closed: getClosedSessionsContribution(receipt),
    itemAdj: getItemAdjustmentContribution(receipt),
    dow: getDayOfWeekContribution(receipt),
  };
}

/** Zero out a contribution set that doesn't belong to the given day. */
export function pickDayContribution(contrib: ContributionSet, dayId: string): ContributionSet {
  if (contrib.payment.dayId !== dayId) return getContributions(null);
  return contrib;
}

export function safeKey(s: string): string {
  return (s || "Uncategorized").trim().replace(/\./g, "·").replace(/\//g, "∕");
}

// --- Preset windows -------------------------------------------------------
function atStartOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, days: number): Date {
  const date = new Date(d.valueOf());
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Which dashboard presets an event date falls into. `now` is explicit so the
 * server can pass authoritative server time instead of the client wall-clock
 * (M-5: client-clock skew around midnight bucketed receipts into the wrong
 * preset). Mirrors the client implementation's windows.
 */
export function getApplicablePresets(eventDate: Date, now: Date = new Date()): string[] {
  const applicable: string[] = [];
  const today = atStartOfDay(now);
  const yesterday = addDays(today, -1);
  const sevenDaysAgo = addDays(today, -6);
  const thirtyDaysAgo = addDays(today, -29);
  const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
  const startOfYear = new Date(today.getFullYear(), 0, 1);

  const eventTime = atStartOfDay(eventDate).getTime();

  if (eventTime === today.getTime()) applicable.push("today");
  if (eventTime === yesterday.getTime()) applicable.push("yesterday");
  if (eventTime >= sevenDaysAgo.getTime() && eventTime <= today.getTime()) applicable.push("last7");
  if (eventTime >= thirtyDaysAgo.getTime() && eventTime <= today.getTime()) applicable.push("last30");
  if (eventTime >= startOfThisMonth.getTime() && eventTime <= today.getTime()) applicable.push("thisMonth");
  if (eventTime >= startOfLastMonth.getTime() && eventTime <= endOfLastMonth.getTime()) applicable.push("lastMonth");
  if (eventTime >= startOfYear.getTime() && eventTime <= today.getTime()) applicable.push("ytd");

  return applicable;
}

// --- Delta increments -----------------------------------------------------
/**
 * Plain field-path -> increment map for one day's old->new contribution delta.
 * The caller wraps each number in its SDK's increment() sentinel. Faithful port
 * of applyAnalyticsDeltaV2's payload logic, returning numbers instead of
 * client-SDK increment() sentinels so it is testable and SDK-agnostic.
 */
export function buildDeltaIncrements(dayOld: ContributionSet, dayNew: ContributionSet): Record<string, number> {
  const out: Record<string, number> = {};
  const inc = (key: string, val: number) => {
    if (val !== 0) out[key] = (out[key] || 0) + val;
  };

  // Payments
  inc("payments.totalGross", dayNew.payment.totalGross - dayOld.payment.totalGross);
  inc("payments.txCount", dayNew.payment.txCount - dayOld.payment.txCount);
  inc("payments.discountsTotal", dayNew.payment.discountsTotal - dayOld.payment.discountsTotal);
  inc("payments.chargesTotal", dayNew.payment.chargesTotal - dayOld.payment.chargesTotal);
  for (const method of new Set([...Object.keys(dayOld.payment.byMethod), ...Object.keys(dayNew.payment.byMethod)])) {
    inc(`payments.byMethod.${safeKey(method)}`, (dayNew.payment.byMethod[method] || 0) - (dayOld.payment.byMethod[method] || 0));
  }

  // Guests
  inc("guests.guestCountFinalTotal", dayNew.guest.guestCountFinal - dayOld.guest.guestCountFinal);
  inc("guests.packageSessionsCount", dayNew.guest.packageSessionsCount - dayOld.guest.packageSessionsCount);
  for (const name of new Set([...Object.keys(dayOld.guest.guestCountFinalByPackageName), ...Object.keys(dayNew.guest.guestCountFinalByPackageName)])) {
    inc(`guests.guestCountFinalByPackageName.${safeKey(name)}`, (dayNew.guest.guestCountFinalByPackageName[name] || 0) - (dayOld.guest.guestCountFinalByPackageName[name] || 0));
  }
  for (const name of new Set([...Object.keys(dayOld.guest.packageCoversBilledByPackageName), ...Object.keys(dayNew.guest.packageCoversBilledByPackageName)])) {
    inc(`guests.packageCoversBilledByPackageName.${safeKey(name)}`, (dayNew.guest.packageCoversBilledByPackageName[name] || 0) - (dayOld.guest.packageCoversBilledByPackageName[name] || 0));
  }

  // Sales totals
  inc("sales.dineInAddonSalesAmount", (dayNew.sales.dineInAddonSalesAmount || 0) - (dayOld.sales.dineInAddonSalesAmount || 0));
  inc("sales.dineInSalesGross", (dayNew.sales.dineInSalesGross || 0) - (dayOld.sales.dineInSalesGross || 0));
  inc("sales.dineInDiscountsTotal", (dayNew.sales.dineInDiscountsTotal || 0) - (dayOld.sales.dineInDiscountsTotal || 0));
  inc("sales.dineInChargesTotal", (dayNew.sales.dineInChargesTotal || 0) - (dayOld.sales.dineInChargesTotal || 0));
  for (const name of new Set([...Object.keys(dayOld.sales.packageSalesAmountByName || {}), ...Object.keys(dayNew.sales.packageSalesAmountByName || {})])) {
    inc(`sales.packageSalesAmountByName.${safeKey(name)}`, (dayNew.sales.packageSalesAmountByName[name] || 0) - (dayOld.sales.packageSalesAmountByName[name] || 0));
    inc(`sales.packageSalesQtyByName.${safeKey(name)}`, (dayNew.sales.packageSalesQtyByName[name] || 0) - (dayOld.sales.packageSalesQtyByName[name] || 0));
  }

  // Addon items + category rollups
  const catQtyDelta: Record<string, number> = {};
  const catAmtDelta: Record<string, number> = {};
  for (const itemName of new Set([...Object.keys(dayOld.sales.addonSalesByItem || {}), ...Object.keys(dayNew.sales.addonSalesByItem || {})])) {
    const oldItem = dayOld.sales.addonSalesByItem?.[itemName];
    const newItem = dayNew.sales.addonSalesByItem?.[itemName];
    const qtyDelta = (newItem?.qty || 0) - (oldItem?.qty || 0);
    const amtDelta = (newItem?.amount || 0) - (oldItem?.amount || 0);
    inc(`sales.addonSalesByItem.${safeKey(itemName)}.qty`, qtyDelta);
    inc(`sales.addonSalesByItem.${safeKey(itemName)}.amount`, amtDelta);
    const cat = safeKey(newItem?.categoryName ?? oldItem?.categoryName ?? "Uncategorized");
    catQtyDelta[cat] = (catQtyDelta[cat] ?? 0) + qtyDelta;
    catAmtDelta[cat] = (catAmtDelta[cat] ?? 0) + amtDelta;
  }
  for (const [cat, qd] of Object.entries(catQtyDelta)) inc(`sales.addonSalesQtyByCategory.${safeKey(cat)}`, qd);
  for (const [cat, ad] of Object.entries(catAmtDelta)) inc(`sales.addonSalesAmountByCategory.${safeKey(cat)}`, ad);

  // Peak hour
  if (dayOld.peak.hourKey !== dayNew.peak.hourKey) {
    if (dayOld.peak.hourKey && dayOld.peak.count > 0) {
      inc(`sales.salesAmountByHour.${dayOld.peak.hourKey}`, -dayOld.peak.amount);
      inc(`sales.sessionCountByHour.${dayOld.peak.hourKey}`, -dayOld.peak.count);
    }
    if (dayNew.peak.hourKey && dayNew.peak.count > 0) {
      inc(`sales.salesAmountByHour.${dayNew.peak.hourKey}`, dayNew.peak.amount);
      inc(`sales.sessionCountByHour.${dayNew.peak.hourKey}`, dayNew.peak.count);
    }
  } else if (dayNew.peak.hourKey && dayNew.peak.amount !== dayOld.peak.amount) {
    inc(`sales.salesAmountByHour.${dayNew.peak.hourKey}`, dayNew.peak.amount - dayOld.peak.amount);
  }

  // Peak hour by mode
  {
    const oldKey = dayOld.peak.mode && dayOld.peak.hourKey && dayOld.peak.count > 0 ? `${dayOld.peak.mode}.${dayOld.peak.hourKey}` : null;
    const newKey = dayNew.peak.mode && dayNew.peak.hourKey && dayNew.peak.count > 0 ? `${dayNew.peak.mode}.${dayNew.peak.hourKey}` : null;
    if (oldKey) { inc(`sales.salesAmountByHourByMode.${oldKey}`, -dayOld.peak.amount); inc(`sales.sessionCountByHourByMode.${oldKey}`, -dayOld.peak.count); }
    if (newKey) { inc(`sales.salesAmountByHourByMode.${newKey}`, dayNew.peak.amount); inc(`sales.sessionCountByHourByMode.${newKey}`, dayNew.peak.count); }
  }

  // Sales by mode totals (gross + net)
  for (const m of ["dineIn", "walkIn"] as const) {
    inc(`sales.salesAmountByMode.${m}`, (dayNew.sales.salesGrossByMode?.[m] || 0) - (dayOld.sales.salesGrossByMode?.[m] || 0));
    inc(`sales.netSalesByMode.${m}`, (dayNew.sales.netSalesByMode?.[m] || 0) - (dayOld.sales.netSalesByMode?.[m] || 0));
  }

  // Day of week
  {
    const oldKey = dayOld.dow.dowKey && dayOld.dow.count > 0 ? dayOld.dow.dowKey : null;
    const newKey = dayNew.dow.dowKey && dayNew.dow.count > 0 ? dayNew.dow.dowKey : null;
    if (oldKey) { inc(`sales.salesAmountByDow.${oldKey}`, -dayOld.dow.amount); inc(`sales.sessionCountByDow.${oldKey}`, -dayOld.dow.count); }
    if (newKey) { inc(`sales.salesAmountByDow.${newKey}`, dayNew.dow.amount); inc(`sales.sessionCountByDow.${newKey}`, dayNew.dow.count); }
  }

  // Closed sessions
  inc("sessions.closedCount", dayNew.closed.closedCount - dayOld.closed.closedCount);
  inc("sessions.totalPaid", dayNew.closed.totalPaid - dayOld.closed.totalPaid);
  {
    const oldKey = dayOld.closed.mode && dayOld.closed.closedCount > 0 ? dayOld.closed.mode : null;
    const newKey = dayNew.closed.mode && dayNew.closed.closedCount > 0 ? dayNew.closed.mode : null;
    if (oldKey) inc(`sessions.closedCountByMode.${oldKey}`, -dayOld.closed.closedCount);
    if (newKey) inc(`sessions.closedCountByMode.${newKey}`, dayNew.closed.closedCount);
  }
  inc("sessions.dineInDurationMsSum", dayNew.closed.dineInDurationMs - dayOld.closed.dineInDurationMs);
  inc("sessions.dineInDurationCount", dayNew.closed.dineInDurationCount - dayOld.closed.dineInDurationCount);

  // Payments txCount by mode
  {
    const oldKey = dayOld.payment.mode && dayOld.payment.txCount > 0 ? dayOld.payment.mode : null;
    const newKey = dayNew.payment.mode && dayNew.payment.txCount > 0 ? dayNew.payment.mode : null;
    if (oldKey) inc(`payments.txCountByMode.${oldKey}`, -dayOld.payment.txCount);
    if (newKey) inc(`payments.txCountByMode.${newKey}`, dayNew.payment.txCount);
  }

  // Item adjustments
  const a0 = dayOld.itemAdj, a1 = dayNew.itemAdj;
  inc("items.voidedQty", a1.voidedQty - a0.voidedQty);
  inc("items.voidedAmount", a1.voidedAmount - a0.voidedAmount);
  inc("items.freeQty", a1.freeQty - a0.freeQty);
  inc("items.freeAmount", a1.freeAmount - a0.freeAmount);
  inc("items.discountedQty", a1.discountedQty - a0.discountedQty);
  inc("items.discountedAmount", a1.discountedAmount - a0.discountedAmount);
  inc("items.refundCount", a1.refundCount - a0.refundCount);
  inc("items.refundTotal", a1.refundTotal - a0.refundTotal);

  // Refills
  inc("refills.packageSessionsCount", dayNew.refill.packageSessionsCount - dayOld.refill.packageSessionsCount);
  inc("refills.servedRefillsTotal", dayNew.refill.servedRefillsTotal - dayOld.refill.servedRefillsTotal);
  for (const name of new Set([...Object.keys(dayOld.refill?.servedRefillsByName || {}), ...Object.keys(dayNew.refill?.servedRefillsByName || {})])) {
    inc(`refills.servedRefillsByName.${safeKey(name)}`, (dayNew.refill?.servedRefillsByName?.[name] ?? 0) - (dayOld.refill?.servedRefillsByName?.[name] ?? 0));
  }

  return out;
}

/** Day ids touched by an old->new receipt delta. */
export function affectedDayIds(oldContrib: ContributionSet, newContrib: ContributionSet): string[] {
  const ids = new Set<string>();
  if (oldContrib.payment.dayId) ids.add(oldContrib.payment.dayId);
  if (newContrib.payment.dayId) ids.add(newContrib.payment.dayId);
  return [...ids];
}
