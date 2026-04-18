
'use client';

import {
  type Firestore,
  type WriteBatch,
  type Transaction,
  increment,
  serverTimestamp,
  doc,
} from 'firebase/firestore';
import { toast } from '@/hooks/use-toast';
import type { Receipt, ReceiptAnalyticsV2, KitchenTicket, LineAdjustment } from '@/lib/types';
import {
  dailyAnalyticsDocRef,
  getPaymentContribution,
  getGuestCoversContribution,
  getSalesContribution,
  getPeakHourContribution,
  getRefillContribution,
  getClosedSessionsContribution,
  getKitchenTicketContribution,
  getItemAdjustmentContribution,
} from './daily';
import { rebuildDailyAnalyticsFromReceipts } from './backfill';
import { toJsDate } from '@/lib/utils/date';

type ContributionSet = {
  payment: ReturnType<typeof getPaymentContribution>;
  guest: ReturnType<typeof getGuestCoversContribution>;
  sales: ReturnType<typeof getSalesContribution>;
  peak: ReturnType<typeof getPeakHourContribution>;
  refill: ReturnType<typeof getRefillContribution>;
  closed: ReturnType<typeof getClosedSessionsContribution>;
  itemAdj: ReturnType<typeof getItemAdjustmentContribution>;
};

// --- Date Helpers for Presets ---
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
 * Determines which dashboard presets are affected by a given event date.
 * @param eventDate The date of the receipt/event.
 * @returns An array of preset ID strings (e.g., ["today", "last7"]).
 */
function getApplicablePresets(eventDate: Date): string[] {
  const applicable: string[] = [];
  const now = new Date();

  const today = atStartOfDay(now);
  const yesterday = addDays(today, -1);
  const sevenDaysAgo = addDays(today, -6);
  const thirtyDaysAgo = addDays(today, -29);
  const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
  const startOfYear = new Date(today.getFullYear(), 0, 1);

  const eventDay = atStartOfDay(eventDate);
  const eventTime = eventDay.getTime();

  if (eventTime === today.getTime()) {
    applicable.push("today");
  }
  if (eventTime === yesterday.getTime()) {
    applicable.push("yesterday");
  }
  if (eventTime >= sevenDaysAgo.getTime() && eventTime <= today.getTime()) {
    applicable.push("last7");
  }
  if (eventTime >= thirtyDaysAgo.getTime() && eventTime <= today.getTime()) {
    applicable.push("last30");
  }
  if (eventTime >= startOfThisMonth.getTime() && eventTime <= today.getTime()) {
    applicable.push("thisMonth");
  }
  if (eventTime >= startOfLastMonth.getTime() && eventTime <= endOfLastMonth.getTime()) {
    applicable.push("lastMonth");
  }
  if (eventTime >= startOfYear.getTime() && eventTime <= today.getTime()) {
    applicable.push("ytd");
  }

  return applicable;
}


function getContributions(receipt: Receipt | null): ContributionSet {
  return {
    payment: getPaymentContribution(receipt),
    guest: getGuestCoversContribution(receipt),
    sales: getSalesContribution(receipt),
    peak: getPeakHourContribution(receipt),
    refill: getRefillContribution(receipt),
    closed: getClosedSessionsContribution(receipt),
    itemAdj: getItemAdjustmentContribution(receipt),
  };
}

function pickDayContribution(contrib: ContributionSet, dayId: string): ContributionSet {
    const nullContrib = getContributions(null);
    if (contrib.payment.dayId !== dayId) {
        return nullContrib;
    }
    return contrib;
}

function safeKey(s: string) {
  return (s || "Uncategorized")
    .trim()
    .replace(/\./g, "·")     // dot is not allowed in field path
    .replace(/\//g, "∕");    // avoid slash confusion
}

type Writer =
  | { kind: "tx"; tx: Transaction }
  | { kind: "batch"; batch: WriteBatch };

function writerSet(w: Writer, ref: any, data: any, opts: any) {
  if (w.kind === "tx") return w.tx.set(ref, data, opts);
  return w.batch.set(ref, data, opts);
}

function writerUpdate(w: Writer, ref: any, data: any) {
  if (w.kind === "tx") return w.tx.update(ref, data);
  return w.batch.update(ref, data);
}

/**
 * Calculates and applies the change (delta) between an old and a new receipt
 * to the daily, monthly, yearly, AND preset analytics documents. This can be part of a larger batch.
 *
 * @param db The Firestore instance.
 * @param storeId The ID of the store to backfill.
 * @param oldReceipt The receipt data *before* the change (or the receipt being deleted).
 * @param newReceipt The receipt data *after* the change (or null if deleting).
 * @param opts Optional object containing a Transaction or WriteBatch to join.
 */
export async function applyAnalyticsDeltaV2(
  db: Firestore,
  storeId: string,
  oldReceipt: Receipt | null,
  newReceipt: Receipt | null,
  opts?: { tx?: Transaction; batch?: WriteBatch }
) {
  const w: Writer | null =
    opts?.tx ? { kind: "tx", tx: opts.tx } :
    opts?.batch ? { kind: "batch", batch: opts.batch } :
    null;

  if (!w) throw new Error("applyAnalyticsDeltaV2 requires tx or batch.");

  const oldContrib = getContributions(oldReceipt);
  const newContrib = getContributions(newReceipt);

  const affectedDayIds = new Set<string>();
  if (oldContrib.payment.dayId) affectedDayIds.add(oldContrib.payment.dayId);
  if (newContrib.payment.dayId) affectedDayIds.add(newContrib.payment.dayId);
  if (affectedDayIds.size === 0) {
    console.warn("[applyAnalyticsDeltaV2] No valid dayId found. Skipping.");
    return;
  }

  for (const dayId of affectedDayIds) {
    const dayOld = pickDayContribution(oldContrib, dayId);
    const dayNew = pickDayContribution(newContrib, dayId);

    const dayStartMs = dayNew.payment.dayStartMs > 0 
      ? dayNew.payment.dayStartMs 
      : (dayOld.payment.dayStartMs > 0 ? dayOld.payment.dayStartMs : 0);

    const dayRef = dailyAnalyticsDocRef(db, storeId, dayId);
    const monthId = dayId.slice(0, 6);
    const yearId = dayId.slice(0, 4);
    const monthRef = doc(db, "stores", storeId, "analyticsMonths", monthId);
    const yearRef  = doc(db, "stores", storeId, "analyticsYears", yearId);

    // --- 1. Get Applicable Presets ---
    const eventDate = toJsDate(dayStartMs);
    const applicablePresets = eventDate ? getApplicablePresets(eventDate) : [];
    
    // --- 2. Ensure Docs Exist ---
    const metaPayload = { meta: { storeId, updatedAt: serverTimestamp() }};
    writerSet(w, dayRef, { meta: { ...metaPayload.meta, dayId, dayStartMs } }, { merge: true });
    writerSet(w, monthRef, { meta: { ...metaPayload.meta, monthId } }, { merge: true });
    writerSet(w, yearRef, { meta: { ...metaPayload.meta, yearId } }, { merge: true });
    
    // Ensure preset docs exist
    for (const presetId of applicablePresets) {
        const presetRef = doc(db, "stores", storeId, "dashPresets", presetId);
        writerSet(w, presetRef, { meta: { presetId, storeId, source: "delta-v2", updatedAt: serverTimestamp() } }, { merge: true });
    }

    // --- 3. Prepare and apply increments ---
    const payload: Record<string, any> = {
      "meta.updatedAt": serverTimestamp(),
    };
    
    // --- Payments Delta ---
    const paymentDelta = {
      totalGross: dayNew.payment.totalGross - dayOld.payment.totalGross,
      txCount: dayNew.payment.txCount - dayOld.payment.txCount,
      discountsTotal: dayNew.payment.discountsTotal - dayOld.payment.discountsTotal,
      chargesTotal: dayNew.payment.chargesTotal - dayOld.payment.chargesTotal,
    };
    if (paymentDelta.totalGross !== 0) payload['payments.totalGross'] = increment(paymentDelta.totalGross);
    if (paymentDelta.txCount !== 0) payload['payments.txCount'] = increment(paymentDelta.txCount);
    if (paymentDelta.discountsTotal !== 0) payload['payments.discountsTotal'] = increment(paymentDelta.discountsTotal);
    if (paymentDelta.chargesTotal !== 0) payload['payments.chargesTotal'] = increment(paymentDelta.chargesTotal);
    
    const allPaymentMethods = new Set([...Object.keys(dayOld.payment.byMethod), ...Object.keys(dayNew.payment.byMethod)]);
    allPaymentMethods.forEach(method => {
      const delta = (dayNew.payment.byMethod[method] || 0) - (dayOld.payment.byMethod[method] || 0);
      if (delta !== 0) payload[`payments.byMethod.${safeKey(method)}`] = increment(delta);
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
        if (delta !== 0) payload[`guests.guestCountFinalByPackageName.${safeKey(name)}`] = increment(delta);
    });

    const allBilledPkgNames = new Set([...Object.keys(dayOld.guest.packageCoversBilledByPackageName), ...Object.keys(dayNew.guest.packageCoversBilledByPackageName)]);
    allBilledPkgNames.forEach(name => {
        const delta = (dayNew.guest.packageCoversBilledByPackageName[name] || 0) - (dayOld.guest.packageCoversBilledByPackageName[name] || 0);
        if (delta !== 0) payload[`guests.packageCoversBilledByPackageName.${safeKey(name)}`] = increment(delta);
    });

    // --- Sales Delta ---
    const salesDelta = {
        dineInAddonSalesAmount: (dayNew.sales.dineInAddonSalesAmount || 0) - (dayOld.sales.dineInAddonSalesAmount || 0),
        dineInSalesGross: (dayNew.sales.dineInSalesGross || 0) - (dayOld.sales.dineInSalesGross || 0),
        dineInDiscountsTotal: (dayNew.sales.dineInDiscountsTotal || 0) - (dayOld.sales.dineInDiscountsTotal || 0),
        dineInChargesTotal: (dayNew.sales.dineInChargesTotal || 0) - (dayOld.sales.dineInChargesTotal || 0),
    };
    if (salesDelta.dineInAddonSalesAmount !== 0) payload['sales.dineInAddonSalesAmount'] = increment(salesDelta.dineInAddonSalesAmount);
    if (salesDelta.dineInSalesGross !== 0) payload['sales.dineInSalesGross'] = increment(salesDelta.dineInSalesGross);
    if (salesDelta.dineInDiscountsTotal !== 0) payload['sales.dineInDiscountsTotal'] = increment(salesDelta.dineInDiscountsTotal);
    if (salesDelta.dineInChargesTotal !== 0) payload['sales.dineInChargesTotal'] = increment(salesDelta.dineInChargesTotal);

    const allSalesPkgNames = new Set([
      ...Object.keys(dayOld.sales.packageSalesAmountByName || {}),
      ...Object.keys(dayNew.sales.packageSalesAmountByName || {}),
    ]);
    allSalesPkgNames.forEach(name => {
        const amountDelta = (dayNew.sales.packageSalesAmountByName[name] || 0) - (dayOld.sales.packageSalesAmountByName[name] || 0);
        const qtyDelta = (dayNew.sales.packageSalesQtyByName[name] || 0) - (dayOld.sales.packageSalesQtyByName[name] || 0);
        if(amountDelta !== 0) payload[`sales.packageSalesAmountByName.${safeKey(name)}`] = increment(amountDelta);
        if(qtyDelta !== 0) payload[`sales.packageSalesQtyByName.${safeKey(name)}`] = increment(qtyDelta);
    });

    const catQtyDelta: Record<string, number> = {};
    const catAmtDelta: Record<string, number> = {};
    
    const allAddonItems = new Set([
      ...Object.keys(dayOld.sales.addonSalesByItem || {}),
      ...Object.keys(dayNew.sales.addonSalesByItem || {}),
    ]);

    allAddonItems.forEach((itemName) => {
      const oldItem = dayOld.sales.addonSalesByItem?.[itemName];
      const newItem = dayNew.sales.addonSalesByItem?.[itemName];

      const qtyDelta = (newItem?.qty || 0) - (oldItem?.qty || 0);
      const amtDelta = (newItem?.amount || 0) - (oldItem?.amount || 0);
      
      if (qtyDelta !== 0) {
          payload[`sales.addonSalesByItem.${safeKey(itemName)}.qty`] = increment(qtyDelta);
      }
      if (amtDelta !== 0) {
           payload[`sales.addonSalesByItem.${safeKey(itemName)}.amount`] = increment(amtDelta);
      }

      const cat = safeKey(newItem?.categoryName ?? oldItem?.categoryName ?? "Uncategorized");
      catQtyDelta[cat] = (catQtyDelta[cat] ?? 0) + qtyDelta;
      catAmtDelta[cat] = (catAmtDelta[cat] ?? 0) + amtDelta;
    });

    for (const [cat, qd] of Object.entries(catQtyDelta)) {
      if (qd !== 0) payload[`sales.addonSalesQtyByCategory.${safeKey(cat)}`] = increment(qd);
    }
    for (const [cat, ad] of Object.entries(catAmtDelta)) {
      if (ad !== 0) payload[`sales.addonSalesAmountByCategory.${safeKey(cat)}`] = increment(ad);
    }
    
    // --- Peak Hour Delta ---
    if (dayOld.peak.hourKey !== dayNew.peak.hourKey) {
        if(dayOld.peak.hourKey && dayOld.peak.count > 0) {
          payload[`sales.salesAmountByHour.${dayOld.peak.hourKey}`] = increment(-dayOld.peak.amount);
          payload[`sales.sessionCountByHour.${dayOld.peak.hourKey}`] = increment(-dayOld.peak.count);
        }
        if(dayNew.peak.hourKey && dayNew.peak.count > 0) {
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

    // --- Item Adjustment Delta ---
    const adjOld = dayOld.itemAdj;
    const adjNew = dayNew.itemAdj;
    if (adjNew.voidedQty !== adjOld.voidedQty) payload['items.voidedQty'] = increment(adjNew.voidedQty - adjOld.voidedQty);
    if (adjNew.voidedAmount !== adjOld.voidedAmount) payload['items.voidedAmount'] = increment(adjNew.voidedAmount - adjOld.voidedAmount);
    if (adjNew.freeQty !== adjOld.freeQty) payload['items.freeQty'] = increment(adjNew.freeQty - adjOld.freeQty);
    if (adjNew.freeAmount !== adjOld.freeAmount) payload['items.freeAmount'] = increment(adjNew.freeAmount - adjOld.freeAmount);
    if (adjNew.discountedQty !== adjOld.discountedQty) payload['items.discountedQty'] = increment(adjNew.discountedQty - adjOld.discountedQty);
    if (adjNew.discountedAmount !== adjOld.discountedAmount) payload['items.discountedAmount'] = increment(adjNew.discountedAmount - adjOld.discountedAmount);
    if (adjNew.refundCount !== adjOld.refundCount) payload['items.refundCount'] = increment(adjNew.refundCount - adjOld.refundCount);
    if (adjNew.refundTotal !== adjOld.refundTotal) payload['items.refundTotal'] = increment(adjNew.refundTotal - adjOld.refundTotal);
    
    // --- Refills Delta ---
    if(dayNew.refill.packageSessionsCount !== dayOld.refill.packageSessionsCount) payload['refills.packageSessionsCount'] = increment(dayNew.refill.packageSessionsCount - dayOld.refill.packageSessionsCount);
    if(dayNew.refill.servedRefillsTotal !== dayOld.refill.servedRefillsTotal) payload['refills.servedRefillsTotal'] = increment(dayNew.refill.servedRefillsTotal - dayOld.refill.servedRefillsTotal);

    const allRefillNames = new Set([
      ...Object.keys(dayOld.refill?.servedRefillsByName || {}),
      ...Object.keys(dayNew.refill?.servedRefillsByName || {}),
    ]);
    allRefillNames.forEach((refillName) => {
        const oldQty = (dayOld.refill?.servedRefillsByName?.[refillName] ?? 0) as number;
        const newQty = (dayNew.refill?.servedRefillsByName?.[refillName] ?? 0) as number;
      
        const qtyDelta = newQty - oldQty;
        if (qtyDelta === 0) return;

        payload[`refills.servedRefillsByName.${safeKey(refillName)}`] = increment(qtyDelta);
    });
    
    // --- Apply final updates to rollup docs ---
    writerUpdate(w, dayRef, payload);
    writerUpdate(w, monthRef, payload);
    writerUpdate(w, yearRef, payload);

    // --- Apply final updates to PRESET docs ---
    for (const presetId of applicablePresets) {
        const presetRef = doc(db, "stores", storeId, "dashPresets", presetId);
        writerUpdate(w, presetRef, payload);
    }
  }

  // If the caller is not providing a transaction or batch, we create our own and commit it.
  if (!opts?.tx && !opts?.batch) {
       try {
          // This path is not currently used by the app, but could be for a standalone script.
          const batch = db ? (await import("firebase/firestore")).writeBatch(db) : null;
          if (batch) {
             // Re-run with the created batch
             await applyAnalyticsDeltaV2(db, storeId, oldReceipt, newReceipt, { batch });
             await batch.commit();
          } else {
             throw new Error("Firestore instance not available for standalone batch.");
          }
       } catch (error) {
            console.error("Failed to apply analytics delta:", error);
            toast({
                variant: "destructive",
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
}

    