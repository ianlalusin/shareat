

"use client";

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
} from "firebase/firestore";
import { toast } from "@/hooks/use-toast";
import type { DailyMetric, Receipt, ReceiptAnalyticsV2, KitchenTicket } from "@/lib/types";
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
} from "./daily";
import { toJsDate } from "@/lib/utils/date";

/**
 * Rebuilds daily analytics documents for a given date range by processing existing receipts and kitchen tickets.
 * This function overwrites existing daily analytics documents for the specified range.
 *
 * @param db The Firestore instance.
 * @param storeId The ID of the store to backfill.
 * @param startDate The start of the date range (inclusive).
 * @param endDate The end of the date range (inclusive).
 * @param onProgress A callback to report progress.
 */
export async function rebuildDailyAnalyticsFromReceipts(
  db: Firestore,
  storeId: string,
  startDate: Date,
  endDate: Date,
  onProgress: (message: string) => void
) {
  onProgress("Querying receipts and kitchen tickets for the selected date range...");

  // 1. Query all receipts and tickets within the date range
  const receiptsRef = collection(db, "stores", storeId, "receipts");
  const qReceipts = query(
    receiptsRef,
    where("createdAt", ">=", Timestamp.fromDate(startDate)),
    where("createdAt", "<=", Timestamp.fromDate(endDate)),
    orderBy("createdAt", "asc")
  );

  const ticketsRef = collectionGroup(db, 'kitchentickets');
  const qTickets = query(
      ticketsRef,
      where("storeId", "==", storeId),
      // Query a slightly wider range for tickets to catch items served the next day
      where("createdAt", ">=", Timestamp.fromDate(new Date(startDate.getTime() - 24 * 60 * 60 * 1000))),
      where("createdAt", "<=", Timestamp.fromDate(new Date(endDate.getTime() + 24 * 60 * 60 * 1000)))
  );

  const [receiptsSnapshot, ticketsSnapshot] = await Promise.all([
    getDocs(qReceipts),
    getDocs(qTickets)
  ]);
  
  const receipts = receiptsSnapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Receipt)
  );
  const tickets = ticketsSnapshot.docs.map(d => d.data() as KitchenTicket);


  if (receipts.length === 0 && tickets.length === 0) {
    onProgress("No data found in the selected date range. Nothing to do.");
    return;
  }

  onProgress(`Found ${receipts.length} receipts and ${tickets.length} tickets. Aggregating daily totals...`);

  // 2. Aggregate data in memory
  const dailyAggregates = new Map < string, DailyMetric > ();

  const ensureDay = (dayId: string, dayStartMs: number) => {
    if (!dailyAggregates.has(dayId)) {
      dailyAggregates.set(dayId, {
        meta: {
          dayId,
          dayStartMs,
          storeId,
          updatedAt: serverTimestamp(),
        },
        payments: { byMethod: {}, totalGross: 0, txCount: 0, discountsTotal: 0, chargesTotal: 0 },
        guests: { guestCountFinalTotal: 0, packageCoversBilledByPackageName: {}, packageSessionsCount: 0, guestCountFinalByPackageName: {} },
        sales: { packageSalesAmountByName: {}, packageSalesQtyByName: {}, addonSalesAmountByCategory: {}, salesAmountByHour: {}, sessionCountByHour: {} },
        kitchen: { servedCountByType: {}, cancelledCountByType: {}, durationMsSumByType: {}, durationCountByType: {} },
        sessions: { closedCount: 0, totalPaid: 0 },
        refills: { servedRefillsTotal: 0, servedRefillsByName: {}, packageSessionsCount: 0 },
      });
    }
    return dailyAggregates.get(dayId)!;
  }

  for (const receipt of receipts) {
    if (receipt.status === 'voided') continue; // Skip voided receipts
    
    const eventMs = receipt.createdAtClientMs || toJsDate(receipt.createdAt)?.getTime();
    if (!eventMs) continue;
    
    const dayId = getDayIdFromTimestamp(eventMs);
    const dayStartMs = getDayStartMs(eventMs);
    const dayData = ensureDay(dayId, dayStartMs);

    // Get contributions from all helpers
    const paymentContrib = getPaymentContribution(receipt);
    const guestContrib = getGuestCoversContribution(receipt);
    const salesContrib = getSalesContribution(receipt);
    const peakHourContrib = getPeakHourContribution(receipt);
    const closedSessionContrib = getClosedSessionsContribution(receipt);
    const refillContrib = getRefillContribution(receipt);

    // Merge contributions into the daily aggregate
    dayData.payments!.totalGross = (dayData.payments!.totalGross || 0) + paymentContrib.totalGross;
    dayData.payments!.txCount = (dayData.payments!.txCount || 0) + paymentContrib.txCount;
    dayData.payments!.discountsTotal = (dayData.payments!.discountsTotal || 0) + paymentContrib.discountsTotal;
    dayData.payments!.chargesTotal = (dayData.payments!.chargesTotal || 0) + paymentContrib.chargesTotal;
    for (const [method, amount] of Object.entries(paymentContrib.byMethod)) {
        dayData.payments!.byMethod[method] = (dayData.payments!.byMethod[method] || 0) + amount;
    }

    dayData.guests!.guestCountFinalTotal = (dayData.guests!.guestCountFinalTotal || 0) + guestContrib.guestCountFinal;
    dayData.guests!.packageSessionsCount = (dayData.guests!.packageSessionsCount || 0) + guestContrib.packageSessionsCount;
     for (const [pkgName, count] of Object.entries(guestContrib.guestCountFinalByPackageName)) {
        dayData.guests!.guestCountFinalByPackageName[pkgName] = (dayData.guests!.guestCountFinalByPackageName[pkgName] || 0) + count;
    }
    for (const [pkgName, count] of Object.entries(guestContrib.packageCoversBilledByPackageName)) {
        dayData.guests!.packageCoversBilledByPackageName[pkgName] = (dayData.guests!.packageCoversBilledByPackageName[pkgName] || 0) + count;
    }
    
    for (const [pkgName, amount] of Object.entries(salesContrib.packageSalesAmountByName)) {
        dayData.sales!.packageSalesAmountByName[pkgName] = (dayData.sales!.packageSalesAmountByName[pkgName] || 0) + amount;
    }
    for (const [pkgName, qty] of Object.entries(salesContrib.packageSalesQtyByName)) {
        dayData.sales!.packageSalesQtyByName[pkgName] = (dayData.sales!.packageSalesQtyByName[pkgName] || 0) + qty;
    }
    for (const [catName, amount] of Object.entries(salesContrib.addonSalesAmountByCategory)) {
        dayData.sales!.addonSalesAmountByCategory[catName] = (dayData.sales!.addonSalesAmountByCategory[catName] || 0) + amount;
    }

    if(peakHourContrib.hourKey) {
        dayData.sales!.salesAmountByHour[peakHourContrib.hourKey] = (dayData.sales!.salesAmountByHour[peakHourContrib.hourKey] || 0) + peakHourContrib.amount;
        dayData.sales!.sessionCountByHour[peakHourContrib.hourKey] = (dayData.sales!.sessionCountByHour[peakHourContrib.hourKey] || 0) + peakHourContrib.count;
    }

    dayData.sessions!.closedCount = (dayData.sessions!.closedCount || 0) + closedSessionContrib.closedCount;
    dayData.sessions!.totalPaid = (dayData.sessions!.totalPaid || 0) + closedSessionContrib.totalPaid;
    
    dayData.refills!.packageSessionsCount = (dayData.refills!.packageSessionsCount || 0) + refillContrib.packageSessionsCount;
    dayData.refills!.servedRefillsTotal = (dayData.refills!.servedRefillsTotal || 0) + refillContrib.servedRefillsTotal;
    for (const [refillName, qty] of Object.entries(refillContrib.servedRefillsByName)) {
        dayData.refills!.servedRefillsByName[refillName] = (dayData.refills!.servedRefillsByName[refillName] || 0) + qty;
    }
  }

  // Process kitchen tickets
  for (const ticket of tickets) {
      const kitchenContrib = getKitchenTicketContribution(ticket);
      if (!kitchenContrib.dayId) continue;
      
      const dayStartMs = kitchenContrib.dayStartMs;
      // Only include tickets that were served/cancelled within the requested range
      if(dayStartMs < startDate.getTime() || dayStartMs > endDate.getTime()) continue;

      const dayData = ensureDay(kitchenContrib.dayId, dayStartMs);
      
      // Merge kitchen contributions
      const typeKey = kitchenContrib.typeKey;
      dayData.kitchen!.servedCountByType[typeKey] = (dayData.kitchen!.servedCountByType[typeKey] || 0) + kitchenContrib.servedCount;
      dayData.kitchen!.cancelledCountByType[typeKey] = (dayData.kitchen!.cancelledCountByType[typeKey] || 0) + kitchenContrib.cancelledCount;
      dayData.kitchen!.durationMsSumByType[typeKey] = (dayData.kitchen!.durationMsSumByType[typeKey] || 0) + kitchenContrib.durationMsSum;
      dayData.kitchen!.durationCountByType[typeKey] = (dayData.kitchen!.durationCountByType[typeKey] || 0) + kitchenContrib.durationCount;
  }


  onProgress(`Aggregated into ${dailyAggregates.size} daily documents. Preparing to write...`);

  // 3. Write results to Firestore using batches
  const batchArray: ReturnType < typeof writeBatch > [] = [];
  batchArray.push(writeBatch(db));
  let operationCount = 0;
  let batchIndex = 0;

  for (const [dayId, data] of dailyAggregates.entries()) {
    const docRef = doc(db, "stores", storeId, "analytics", dayId);
    
    // Add backfill timestamp to meta
    data.meta.backfilledAt = serverTimestamp();
    data.meta.source = "backfill_v3_receipts_and_kds";

    batchArray[batchIndex].set(docRef, data, { merge: false }); // Overwrite!
    operationCount++;

    if (operationCount === 499) {
      batchArray.push(writeBatch(db));
      batchIndex++;
      operationCount = 0;
    }
  }

  // 4. Commit all batches
  onProgress(`Writing ${dailyAggregates.size} documents across ${batchArray.length} batches...`);
  await Promise.all(batchArray.map((batch) => batch.commit()));

  onProgress(`Backfill complete.`);
}
