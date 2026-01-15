

'use client';

import {
  writeBatch,
  type Firestore,
  increment,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import type { Receipt } from '@/lib/types';
import {
  dailyAnalyticsDocRef,
  getPaymentContribution,
  getGuestCoversContribution,
  getSalesContribution,
  getPeakHourContribution,
  getRefillContribution,
  getClosedSessionsContribution,
} from './daily';
import { rebuildDailyAnalyticsFromReceipts } from './backfill';

type ContributionSet = {
  payment: ReturnType<typeof getPaymentContribution>;
  guest: ReturnType<typeof getGuestCoversContribution>;
  sales: ReturnType<typeof getSalesContribution>;
  peak: ReturnType<typeof getPeakHourContribution>;
  closed: ReturnType<typeof getClosedSessionsContribution>;
  refill: ReturnType<typeof getRefillContribution>;
};

function getContributions(receipt: Receipt | null): ContributionSet {
  return {
    payment: getPaymentContribution(receipt),
    guest: getGuestCoversContribution(receipt),
    sales: getSalesContribution(receipt),
    peak: getPeakHourContribution(receipt),
    closed: getClosedSessionsContribution(receipt),
    refill: getRefillContribution(receipt),
  };
}

/**
 * Calculates and applies the change (delta) between an old and a new receipt
 * to the daily analytics documents. This is used for receipt edits and deletions.
 *
 * @param db The Firestore instance.
 * @param storeId The ID of the store.
 * @param oldReceipt The receipt data *before* the change (or the receipt being deleted).
 * @param newReceipt The receipt data *after* the change (or null if deleting).
 */
export async function applyAnalyticsDeltaV2(
  db: Firestore,
  storeId: string,
  oldReceipt: Receipt | null,
  newReceipt: Receipt | null
) {
  const oldContrib = getContributions(oldReceipt);
  const newContrib = getContributions(newReceipt);

  const affectedDayIds = new Set<string>();
  if (oldContrib.payment.dayId) affectedDayIds.add(oldContrib.payment.dayId);
  if (newContrib.payment.dayId) affectedDayIds.add(newContrib.payment.dayId);
  if (affectedDayIds.size === 0) {
    console.warn("[applyAnalyticsDeltaV2] No valid dayId found for delta operation. Skipping.");
    return;
  }

  const batch = writeBatch(db);

  for (const dayId of affectedDayIds) {
    let payload: Record<string, any> = {
      meta: { dayId, storeId, updatedAt: serverTimestamp() },
    };
    
    // Determine the contribution sets to use for this day
    const dayOld = (oldReceipt && oldContrib.payment.dayId === dayId) ? oldContrib : getContributions(null);
    const dayNew = (newReceipt && newContrib.payment.dayId === dayId) ? newContrib : getContributions(null);

    // --- Payments Delta ---
    const paymentDelta = {
      totalGross: dayNew.payment.totalGross - dayOld.payment.totalGross,
      txCount: dayNew.payment.txCount - dayOld.payment.txCount,
    };
    if (paymentDelta.totalGross !== 0) payload['payments.totalGross'] = increment(paymentDelta.totalGross);
    if (paymentDelta.txCount !== 0) payload['payments.txCount'] = increment(paymentDelta.txCount);
    
    const allPaymentMethods = new Set([...Object.keys(dayOld.payment.byMethod), ...Object.keys(dayNew.payment.byMethod)]);
    allPaymentMethods.forEach(method => {
      const delta = (dayNew.payment.byMethod[method] || 0) - (dayOld.payment.byMethod[method] || 0);
      if (delta !== 0) payload[`payments.byMethod.${method}`] = increment(delta);
    });

    // --- Guests Delta ---
    const guestDelta = {
      guestCountFinalTotal: dayNew.guest.guestCountFinal - dayOld.guest.guestCountFinal,
      packageSessionsCount: dayNew.guest.packageSessionsCount - dayOld.guest.packageSessionsCount,
    };
    if (guestDelta.guestCountFinalTotal !== 0) payload['guests.guestCountFinalTotal'] = increment(guestDelta.guestCountFinalTotal);
    if (guestDelta.packageSessionsCount !== 0) payload['guests.packageSessionsCount'] = increment(guestDelta.packageSessionsCount);
    
    const allGuestPkgNames = new Set([...Object.keys(dayOld.guest.guestCountFinalByPackageName), ...Object.keys(dayNew.guest.guestCountFinalByPackageName)]);
    allGuestPkgNames.forEach(name => {
        const delta = (dayNew.guest.guestCountFinalByPackageName[name] || 0) - (dayOld.guest.guestCountFinalByPackageName[name] || 0);
        if (delta !== 0) payload[`guests.guestCountFinalByPackageName.${name}`] = increment(delta);
    });


    // --- Sales Delta ---
    const allSalesPkgNames = new Set([...Object.keys(dayOld.sales.packageSalesAmountByName), ...Object.keys(newContrib.sales.packageSalesAmountByName)]);
    allSalesPkgNames.forEach(name => {
        const amountDelta = (dayNew.sales.packageSalesAmountByName[name] || 0) - (dayOld.sales.packageSalesAmountByName[name] || 0);
        const qtyDelta = (dayNew.sales.packageSalesQtyByName[name] || 0) - (dayOld.sales.packageSalesQtyByName[name] || 0);
        if(amountDelta !== 0) payload[`sales.packageSalesAmountByName.${name}`] = increment(amountDelta);
        if(qtyDelta !== 0) payload[`sales.packageSalesQtyByName.${name}`] = increment(qtyDelta);
    });
    
    const allAddonCategories = new Set([...Object.keys(dayOld.sales.addonSalesAmountByCategory), ...Object.keys(dayNew.sales.addonSalesAmountByCategory)]);
    allAddonCategories.forEach(cat => {
        const delta = (dayNew.sales.addonSalesAmountByCategory[cat] || 0) - (dayOld.sales.addonSalesAmountByCategory[cat] || 0);
        if (delta !== 0) payload[`sales.addonSalesAmountByCategory.${cat}`] = increment(delta);
    });

     const allAddonItems = new Set([...Object.keys(dayOld.sales.addonSalesByItem), ...Object.keys(dayNew.sales.addonSalesByItem)]);
     allAddonItems.forEach(item => {
        const qtyDelta = (dayNew.sales.addonSalesByItem[item]?.qty || 0) - (dayOld.sales.addonSalesByItem[item]?.qty || 0);
        const amountDelta = (dayNew.sales.addonSalesByItem[item]?.amount || 0) - (dayOld.sales.addonSalesByItem[item]?.amount || 0);
        if(qtyDelta !== 0) payload[`sales.addonSalesByItem.${item}.qty`] = increment(qtyDelta);
        if(amountDelta !== 0) payload[`sales.addonSalesByItem.${item}.amount`] = increment(amountDelta);
    });


    // --- Peak Hour Delta ---
    if (dayOld.peak.hourKey !== dayNew.peak.hourKey) {
        if(dayOld.peak.hourKey) {
          payload[`sales.salesAmountByHour.${dayOld.peak.hourKey}`] = increment(-dayOld.peak.amount);
          payload[`sales.sessionCountByHour.${dayOld.peak.hourKey}`] = increment(-dayOld.peak.count);
        }
        if(dayNew.peak.hourKey) {
          payload[`sales.salesAmountByHour.${dayNew.peak.hourKey}`] = increment(dayNew.peak.amount);
          payload[`sales.sessionCountByHour.${dayNew.peak.hourKey}`] = increment(dayNew.peak.count);
        }
    } else if (dayNew.peak.hourKey && (dayNew.peak.amount !== dayOld.peak.amount)) {
        const amountDelta = dayNew.peak.amount - dayOld.peak.amount;
        if(amountDelta !== 0) payload[`sales.salesAmountByHour.${dayNew.peak.hourKey}`] = increment(amountDelta);
    }
    
    // --- Closed Sessions Delta ---
    if (dayNew.closed.closedCount !== dayOld.closed.closedCount) payload['sessions.closedCount'] = increment(dayNew.closed.closedCount - dayOld.closed.closedCount);
    if (dayNew.closed.totalPaid !== dayOld.closed.totalPaid) payload['sessions.totalPaid'] = increment(dayNew.closed.totalPaid - dayOld.closed.totalPaid);

    // --- Refills Delta ---
    if(dayNew.refill.packageSessionsCount !== dayOld.refill.packageSessionsCount) payload['refills.packageSessionsCount'] = increment(dayNew.refill.packageSessionsCount - dayOld.refill.packageSessionsCount);
    if(dayNew.refill.servedRefillsTotal !== dayOld.refill.servedRefillsTotal) payload['refills.servedRefillsTotal'] = increment(dayNew.refill.servedRefillsTotal - dayOld.refill.servedRefillsTotal);

    const allRefillNames = new Set([...Object.keys(dayOld.refill.servedRefillsByName), ...Object.keys(dayNew.refill.servedRefillsByName)]);
    allRefillNames.forEach(name => {
        const delta = (dayNew.refill.servedRefillsByName[name] || 0) - (dayOld.refill.servedRefillsByName[name] || 0);
        if(delta !== 0) payload[`refills.servedRefillsByName.${name}`] = increment(delta);
    });
    
    const docRef = dailyAnalyticsDocRef(db, storeId, dayId);
    batch.set(docRef, payload, { merge: true });
  }

  try {
    await batch.commit();
  } catch (error) {
    console.error("Failed to apply analytics delta:", error);
    toast({
      variant: 'destructive',
      title: 'Analytics Update Failed',
      description: 'Attempting to rebuild daily analytics. The dashboard may be out of sync temporarily.',
    });
    // Fallback: Rebuild analytics for the affected days
    const dates = Array.from(affectedDayIds).map(id => new Date(`${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`));
    if (dates.length > 0) {
        const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
        rebuildDailyAnalyticsFromReceipts(db, storeId, minDate, maxDate, (msg) => console.log(`[Analytics Fallback]: ${msg}`)).catch(e => {
             console.error("Analytics fallback rebuild also failed:", e);
             toast({ variant: 'destructive', title: 'Critical Analytics Failure', description: 'Please contact support.' });
        });
    }
  }
}
