

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
} from "firebase/firestore";
import { toast } from "@/hooks/use-toast";
import type { DailyMetric, Receipt, ReceiptAnalyticsV2 } from "@/lib/types";
import {
  getDayIdFromTimestamp,
  getDayStartMs,
  getPaymentContribution,
  getGuestCoversContribution,
  getSalesContribution,
  getPeakHourContribution,
  getRefillContribution,
  getClosedSessionsContribution,
} from "./daily";
import {
  merge,
  mergeWith,
  isObject
} from "lodash";

/**
 * Custom merger for lodash.mergeWith that sums numbers.
 */
function customMerger(objValue: any, srcValue: any) {
  if (typeof objValue === 'number' && typeof srcValue === 'number') {
    return objValue + srcValue;
  }
  // Let lodash handle the rest
}

/**
 * Rebuilds daily analytics documents for a given date range by processing existing receipts.
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
  onProgress("Querying receipts for the selected date range...");

  // 1. Query all receipts within the date range
  const receiptsRef = collection(db, "stores", storeId, "receipts");
  const q = query(
    receiptsRef,
    where("createdAt", ">=", Timestamp.fromDate(startDate)),
    where("createdAt", "<=", Timestamp.fromDate(endDate)),
    orderBy("createdAt", "asc")
  );

  const receiptsSnapshot = await getDocs(q);
  const receipts = receiptsSnapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Receipt)
  );

  if (receipts.length === 0) {
    onProgress("No receipts found in the selected date range. Nothing to do.");
    return;
  }

  onProgress(`Found ${receipts.length} receipts. Aggregating daily totals...`);

  // 2. Aggregate data in memory
  const dailyAggregates = new Map < string, DailyMetric > ();

  for (const receipt of receipts) {
    if (receipt.status === 'voided') continue; // Skip voided receipts
    
    const dayId = getDayIdFromTimestamp(receipt.createdAt);
    if (!dayId) continue;

    if (!dailyAggregates.has(dayId)) {
      dailyAggregates.set(dayId, {
        meta: {
          dayId,
          dayStartMs: getDayStartMs(receipt.createdAt),
          storeId,
          updatedAt: serverTimestamp(),
        },
        payments: { byMethod: {}, totalGross: 0, txCount: 0 },
        guests: { guestCountFinalTotal: 0, packageCoversBilledByPackageName: {}, packageSessionsCount: 0, guestCountFinalByPackageName: {} },
        sales: { packageSalesAmountByName: {}, packageSalesQtyByName: {}, addonSalesAmountByCategory: {}, addonSalesByItem: {}, salesAmountByHour: {}, sessionCountByHour: {} },
        kitchen: { servedCountByType: {}, cancelledCountByType: {}, durationMsSumByType: {}, durationCountByType: {} },
        sessions: { closedCount: 0, totalPaid: 0 },
        refills: { servedRefillsTotal: 0, servedRefillsByName: {}, packageSessionsCount: 0 },
      });
    }

    const dayData = dailyAggregates.get(dayId) !;

    // Get contributions from all helpers
    const paymentContrib = getPaymentContribution(receipt);
    const guestContrib = getGuestCoversContribution(receipt);
    const salesContrib = getSalesContribution(receipt);
    const peakHourContrib = getPeakHourContribution(receipt);
    const closedSessionContrib = getClosedSessionsContribution(receipt);
    const refillContrib = getRefillContribution(receipt);

    // Merge contributions into the daily aggregate
    dayData.payments.totalGross += paymentContrib.totalGross;
    dayData.payments.txCount += paymentContrib.txCount;
    for (const [method, amount] of Object.entries(paymentContrib.byMethod)) {
        dayData.payments.byMethod[method] = (dayData.payments.byMethod[method] || 0) + amount;
    }

    dayData.guests.guestCountFinalTotal += guestContrib.guestCountFinal;
    dayData.guests.packageSessionsCount += guestContrib.packageSessionsCount;
     for (const [pkgName, count] of Object.entries(guestContrib.guestCountFinalByPackageName)) {
        dayData.guests.guestCountFinalByPackageName[pkgName] = (dayData.guests.guestCountFinalByPackageName[pkgName] || 0) + count;
    }
    for (const [pkgName, count] of Object.entries(guestContrib.packageCoversBilledByPackageName)) {
        dayData.guests.packageCoversBilledByPackageName[pkgName] = (dayData.guests.packageCoversBilledByPackageName[pkgName] || 0) + count;
    }
    
    for (const [pkgName, amount] of Object.entries(salesContrib.packageSalesAmountByName)) {
        dayData.sales.packageSalesAmountByName[pkgName] = (dayData.sales.packageSalesAmountByName[pkgName] || 0) + amount;
    }
    for (const [pkgName, qty] of Object.entries(salesContrib.packageSalesQtyByName)) {
        dayData.sales.packageSalesQtyByName[pkgName] = (dayData.sales.packageSalesQtyByName[pkgName] || 0) + qty;
    }
    for (const [catName, amount] of Object.entries(salesContrib.addonSalesAmountByCategory)) {
        dayData.sales.addonSalesAmountByCategory[catName] = (dayData.sales.addonSalesAmountByCategory[catName] || 0) + amount;
    }

    if(peakHourContrib.hourKey) {
        dayData.sales.salesAmountByHour![peakHourContrib.hourKey] = (dayData.sales.salesAmountByHour![peakHourContrib.hourKey] || 0) + peakHourContrib.amount;
        dayData.sales.sessionCountByHour![peakHourContrib.hourKey] = (dayData.sales.sessionCountByHour![peakHourContrib.hourKey] || 0) + peakHourContrib.count;
    }

    dayData.sessions.closedCount += closedSessionContrib.closedCount;
    dayData.sessions.totalPaid += closedSessionContrib.totalPaid;
    
    dayData.refills.packageSessionsCount += refillContrib.packageSessionsCount;
    dayData.refills.servedRefillsTotal += refillContrib.servedRefillsTotal;
    for (const [refillName, qty] of Object.entries(refillContrib.servedRefillsByName)) {
        dayData.refills.servedRefillsByName[refillName] = (dayData.refills.servedRefillsByName[refillName] || 0) + qty;
    }
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
    data.meta.source = "backfill_receipts_v2";

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

  onProgress(`Backfill complete for ${receipts.length} receipts.`);
}
