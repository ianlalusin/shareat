
'use client';

import {
  collection,
  query,
  where,
  orderBy,
  Timestamp,
  writeBatch,
  getDocs,
  doc,
  serverTimestamp,
  type Firestore,
  collectionGroup,
  getDoc,
} from "firebase/firestore";

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
} from "./daily";
import { toJsDate } from "@/lib/utils/date";

/**
 * Rebuilds daily analytics documents for a given date range by processing existing receipts and kitchen tickets.
 * This overwrites existing daily analytics documents for the specified range.
 *
 * Primary goal: backfill payment mix correctly (subtract change from cash for historical receipts).
 */
export async function rebuildDailyAnalyticsFromReceipts(
  db: Firestore,
  storeId: string,
  startDate: Date,
  endDate: Date,
  onProgress: (message: string) => void
) {
  onProgress("Querying receipts and kitchen tickets for the selected date range...");

  // Normalize date bounds:
  // - startInclusive = startDate
  // - endExclusive = endDate + 1 day (so full endDate is included even if time is 00:00)
  const startInclusive = new Date(startDate);
  const endExclusive = new Date(endDate);
  endExclusive.setDate(endExclusive.getDate() + 1);

  // Fetch store object for tax info
  const storeRef = doc(db, "stores", storeId);
  const storeSnap = await getDoc(storeRef);
  if (!storeSnap.exists()) {
    onProgress("Error: Store not found.");
    throw new Error("Store not found.");
  }
  const store = storeSnap.data() as Store;

  // 1) Query receipts within range
  const receiptsRef = collection(db, "stores", storeId, "receipts");
  const qReceipts = query(
    receiptsRef,
    where("createdAt", ">=", Timestamp.fromDate(startInclusive)),
    where("createdAt", "<", Timestamp.fromDate(endExclusive)),
    orderBy("createdAt", "asc")
  );

  // 2) Query kitchen tickets within a slightly wider window to catch served next day
  const ticketsRef = collectionGroup(db, "kitchentickets");
  const ticketsStart = new Date(startInclusive.getTime() - 24 * 60 * 60 * 1000);
  const ticketsEnd = new Date(endExclusive.getTime() + 24 * 60 * 60 * 1000);

  const qTickets = query(
    ticketsRef,
    where("storeId", "==", storeId),
    where("createdAt", ">=", Timestamp.fromDate(ticketsStart)),
    where("createdAt", "<", Timestamp.fromDate(ticketsEnd))
  );

  const [receiptsSnapshot, ticketsSnapshot] = await Promise.all([getDocs(qReceipts), getDocs(qTickets)]);

  const receipts = receiptsSnapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Receipt));
  const tickets = ticketsSnapshot.docs.map((d) => d.data() as KitchenTicket);

  if (receipts.length === 0 && tickets.length === 0) {
    onProgress("No data found in the selected date range. Nothing to do.");
    return;
  }

  onProgress(`Found ${receipts.length} receipts and ${tickets.length} tickets. Aggregating daily totals...`);

  // --- helpers ---
  const dailyAggregates = new Map<string, DailyMetric>();

  const ensureDay = (dayId: string, dayStartMs: number) => {
    if (!dailyAggregates.has(dayId)) {
      dailyAggregates.set(dayId, {
        meta: {
          dayId,
          dayStartMs,
          storeId,
          updatedAt: serverTimestamp(),
        },
        payments: {
          byMethod: {},
          totalGross: 0,
          txCount: 0,
          discountsTotal: 0,
          chargesTotal: 0,
        },
        guests: {
          guestCountFinalTotal: 0,
          packageCoversBilledByPackageName: {},
          packageSessionsCount: 0,
          guestCountFinalByPackageName: {},
        },
        sales: {
          packageSalesAmountByName: {},
          packageSalesQtyByName: {},
          addonSalesAmountByCategory: {},
          addonSalesQtyByCategory: {},
          addonSalesByItem: {},
          dineInAddonSalesAmount: 0,
          salesAmountByHour: {},
          sessionCountByHour: {},
        },
        kitchen: {
          servedCountByType: {},
          cancelledCountByType: {},
          durationMsSumByType: {},
          durationCountByType: {},
          durationMsSumByLocation: {},
          durationCountByLocation: {},
        },
        sessions: { closedCount: 0, totalPaid: 0 },
        refills: { servedRefillsTotal: 0, servedRefillsByName: {}, packageSessionsCount: 0 },
        items: { voidedQty: 0, voidedAmount: 0, freeQty: 0, freeAmount: 0, discountedQty: 0, discountedAmount: 0, refundCount: 0, refundTotal: 0 },
      });
    }
    return dailyAggregates.get(dayId)!;
  };

  const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

  /**
   * Fix payment mix for historical receipts:
   * - Old style: sum(mop) ~= totalPaid (cash includes change)
   * - New style: sum(mop) ~= grandTotal (change already subtracted from cash)
   * We only subtract change from cash if it "looks old" to avoid double-subtract.
   */
  const correctedByMethodForReceipt = (receipt: Receipt, byMethodIn: Record<string, number>) => {
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

    // backfill: net cash should subtract change for historical receipts
    const fixedByMethod = correctedByMethodForReceipt(receipt, (paymentContrib.byMethod || {}) as any);

    const guestContrib = getGuestCoversContribution(receipt);
    const salesContrib = getSalesContribution(receipt, store);
    const peakHourContrib = getPeakHourContribution(receipt);
    const closedSessionContrib = getClosedSessionsContribution(receipt);
    const refillContrib = getRefillContribution(receipt);

    // payments
    dayData.payments!.totalGross = (dayData.payments!.totalGross || 0) + Number(paymentContrib.totalGross || 0);
    dayData.payments!.txCount = (dayData.payments!.txCount || 0) + Number(paymentContrib.txCount || 0);
    dayData.payments!.discountsTotal =
      (dayData.payments!.discountsTotal || 0) + Number(paymentContrib.discountsTotal || 0);
    dayData.payments!.chargesTotal =
      (dayData.payments!.chargesTotal || 0) + Number(paymentContrib.chargesTotal || 0);

    for (const [method, amount] of Object.entries(fixedByMethod)) {
      dayData.payments!.byMethod[method] = (dayData.payments!.byMethod[method] || 0) + Number(amount || 0);
    }

    // guests
    dayData.guests ??= { guestCountFinalTotal: 0, packageCoversBilledByPackageName: {}, packageSessionsCount: 0, guestCountFinalByPackageName: {} };
    dayData.guests.guestCountFinalByPackageName ??= {};
    dayData.guests.packageCoversBilledByPackageName ??= {};
    
    dayData.guests.guestCountFinalTotal = (dayData.guests.guestCountFinalTotal || 0) + Number(guestContrib.guestCountFinal || 0);
    dayData.guests.packageSessionsCount = (dayData.guests.packageSessionsCount || 0) + Number(guestContrib.packageSessionsCount || 0);

    for (const [pkgName, count] of Object.entries(guestContrib.guestCountFinalByPackageName || {})) {
        dayData.guests.guestCountFinalByPackageName[pkgName] = (dayData.guests.guestCountFinalByPackageName[pkgName] || 0) + Number(count || 0);
    }
    for (const [pkgName, count] of Object.entries(guestContrib.packageCoversBilledByPackageName || {})) {
        dayData.guests.packageCoversBilledByPackageName[pkgName] = (dayData.guests.packageCoversBilledByPackageName[pkgName] || 0) + Number(count || 0);
    }

    // sales
    dayData.sales ??= { packageSalesAmountByName: {}, packageSalesQtyByName: {}, addonSalesAmountByCategory: {}, addonSalesQtyByCategory: {}, addonSalesByItem: {}, salesAmountByHour: {}, sessionCountByHour: {} };
    dayData.sales.dineInAddonSalesAmount = (dayData.sales.dineInAddonSalesAmount || 0) + Number(salesContrib.dineInAddonSalesAmount || 0);
    
    for (const [pkgName, amount] of Object.entries(salesContrib.packageSalesAmountByName || {})) {
      dayData.sales.packageSalesAmountByName[pkgName] =
        (dayData.sales.packageSalesAmountByName[pkgName] || 0) + Number(amount || 0);
    }
    for (const [pkgName, qty] of Object.entries(salesContrib.packageSalesQtyByName || {})) {
      dayData.sales.packageSalesQtyByName[pkgName] =
        (dayData.sales.packageSalesQtyByName[pkgName] || 0) + Number(qty || 0);
    }
    for (const [catName, amount] of Object.entries(salesContrib.addonSalesAmountByCategory || {})) {
      dayData.sales.addonSalesAmountByCategory[catName] =
        (dayData.sales.addonSalesAmountByCategory[catName] || 0) + Number(amount || 0);
    }
     for (const [catName, qty] of Object.entries(salesContrib.addonSalesQtyByCategory || {})) {
      dayData.sales.addonSalesQtyByCategory[catName] =
        (dayData.sales.addonSalesQtyByCategory[catName] || 0) + Number(qty || 0);
    }
    for (const [itemName, itemData] of Object.entries(salesContrib.addonSalesByItem || {})) {
      dayData.sales.addonSalesByItem ??= {};
      if (!dayData.sales.addonSalesByItem[itemName]) {
        dayData.sales.addonSalesByItem[itemName] = { qty: 0, amount: 0, categoryName: itemData.categoryName };
      }
      dayData.sales.addonSalesByItem[itemName].qty += itemData.qty;
      dayData.sales.addonSalesByItem[itemName].amount += itemData.amount;
    }


    // peak hours
    if (peakHourContrib.hourKey) {
      dayData.sales!.salesAmountByHour[peakHourContrib.hourKey] =
        (dayData.sales!.salesAmountByHour[peakHourContrib.hourKey] || 0) + Number(peakHourContrib.amount || 0);

      dayData.sales!.sessionCountByHour[peakHourContrib.hourKey] =
        (dayData.sales!.sessionCountByHour[peakHourContrib.hourKey] || 0) + Number(peakHourContrib.count || 0);
    }

    // sessions
    dayData.sessions!.closedCount =
      (dayData.sessions!.closedCount || 0) + Number(closedSessionContrib.closedCount || 0);
    dayData.sessions!.totalPaid = (dayData.sessions!.totalPaid || 0) + Number(closedSessionContrib.totalPaid || 0);

    // refills
    dayData.refills!.packageSessionsCount =
      (dayData.refills!.packageSessionsCount || 0) + Number(refillContrib.packageSessionsCount || 0);
    dayData.refills!.servedRefillsTotal =
      (dayData.refills!.servedRefillsTotal || 0) + Number(refillContrib.servedRefillsTotal || 0);

    for (const [refillName, qty] of Object.entries(refillContrib.servedRefillsByName || {})) {
      dayData.refills!.servedRefillsByName[refillName] =
        (dayData.refills!.servedRefillsByName[refillName] || 0) + Number(qty || 0);
    }
    // item adjustments
    const adjContrib = getItemAdjustmentContribution(receipt);
    const items = (dayData as any).items ??= { voidedQty: 0, voidedAmount: 0, freeQty: 0, freeAmount: 0, discountedQty: 0, discountedAmount: 0, refundCount: 0, refundTotal: 0 };
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

    // Only include tickets whose computed dayStartMs falls within requested range
    // Use startInclusive/endExclusive boundaries (dayStartMs is usually midnight for that day).
    if (kitchenContrib.dayStartMs < startInclusive.getTime() || kitchenContrib.dayStartMs >= endExclusive.getTime()) {
      continue;
    }

    const dayData = ensureDay(kitchenContrib.dayId, kitchenContrib.dayStartMs);

    const typeKey = kitchenContrib.typeKey;
    dayData.kitchen!.servedCountByType[typeKey] =
      (dayData.kitchen!.servedCountByType[typeKey] || 0) + Number(kitchenContrib.servedCount || 0);
    dayData.kitchen!.cancelledCountByType[typeKey] =
      (dayData.kitchen!.cancelledCountByType[typeKey] || 0) + Number(kitchenContrib.cancelledCount || 0);
    dayData.kitchen!.durationMsSumByType[typeKey] =
      (dayData.kitchen!.durationMsSumByType[typeKey] || 0) + Number(kitchenContrib.durationMsSum || 0);
    dayData.kitchen!.durationCountByType[typeKey] =
      (dayData.kitchen!.durationCountByType[typeKey] || 0) + Number(kitchenContrib.durationCount || 0);
      
    // Aggregate by location
    if (ticket.status === 'served') {
        const locationId = ticket.kitchenLocationId;
        if (locationId) {
            const dur = Number(ticket.durationMs ?? 0);
            const qty = Number(ticket.qty ?? 1);
            
            dayData.kitchen!.durationMsSumByLocation![locationId] = (dayData.kitchen!.durationMsSumByLocation![locationId] || 0) + (dur > 0 ? dur : 0);
            dayData.kitchen!.durationCountByLocation![locationId] = (dayData.kitchen!.durationCountByLocation![locationId] || 0) + qty;
        }
    }
  }

  onProgress(`Aggregated into ${dailyAggregates.size} daily documents. Preparing to write...`);

  // --- write ---
  const batches: ReturnType<typeof writeBatch>[] = [writeBatch(db)];
  let opCount = 0;

  for (const [dayId, data] of dailyAggregates.entries()) {
    const docRef = doc(db, "stores", storeId, "analytics", dayId);

    // meta stamps
    (data.meta as any).backfilledAt = serverTimestamp();
    (data.meta as any).source = "backfill_v4_receipts_and_kds";

    batches[batches.length - 1].set(docRef, data, { merge: false }); // overwrite
    opCount++;

    if (opCount >= 499) {
      batches.push(writeBatch(db));
      opCount = 0;
    }
  }

  onProgress(`Writing ${dailyAggregates.size} documents across ${batches.length} batches...`);
  await Promise.all(batches.map((b) => b.commit()));

  onProgress("Backfill complete.");
}

    