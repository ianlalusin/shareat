
'use client';

import {
  writeBatch,
  type Firestore,
  type WriteBatch,
  increment,
  serverTimestamp,
  setDoc,
  doc,
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

function pickDayContribution(contrib: ContributionSet, dayId: string): ContributionSet {
    const nullContrib = getContributions(null);
    if (contrib.payment.dayId !== dayId) {
        return nullContrib;
    }
    return contrib;
}

function toSafeDocId(raw: string) {
  // stable + Firestore-safe (avoid / and weird chars)
  return encodeURIComponent(raw).replace(/%/g, "_").slice(0, 500);
}

function safeKey(s: string) {
  return (s || "Uncategorized")
    .trim()
    .replace(/\./g, "·")     // dot is not allowed in field path
    .replace(/\//g, "∕");    // avoid slash confusion
}


/**
 * Calculates and applies the change (delta) between an old and a new receipt
 * to the daily analytics documents. This can be part of a larger batch.
 *
 * @param db The Firestore instance.
 * @param storeId The ID of the store to backfill.
 * @param oldReceipt The receipt data *before* the change (or the receipt being deleted).
 * @param newReceipt The receipt data *after* the change (or null if deleting).
 * @param opts Optional object containing a WriteBatch to join.
 */
export async function applyAnalyticsDeltaV2(
  db: Firestore,
  storeId: string,
  oldReceipt: Receipt | null,
  newReceipt: Receipt | null,
  opts?: { batch?: WriteBatch }
) {
  const externalBatch = opts?.batch;
  const batch = externalBatch ?? writeBatch(db);

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

    const payload: Record<string, any> = {
      "meta.dayId": dayId,
      "meta.storeId": storeId,
      "meta.updatedAt": serverTimestamp(),
    };
    
    // Add dayStartMs only if it's from a valid contribution, ensuring the meta doc is created.
    if (dayNew.payment.dayStartMs > 0) {
        payload["meta.dayStartMs"] = dayNew.payment.dayStartMs;
    } else if (dayOld.payment.dayStartMs > 0) {
        payload["meta.dayStartMs"] = dayOld.payment.dayStartMs;
    }

    // --- Payments Delta ---
    const paymentDelta = {
      totalGross: dayNew.payment.totalGross - dayOld.payment.totalGross,
      txCount: dayNew.payment.txCount - dayOld.payment.txCount,
    };
    if (paymentDelta.totalGross !== 0) payload['payments.totalGross'] = increment(paymentDelta.totalGross);
    if (paymentDelta.txCount !== 0) payload['payments.txCount'] = increment(paymentDelta.txCount);
    
    const allPaymentMethods = new Set([...Object.keys(dayOld.payment.byMethod), ...Object.keys(newContrib.payment.byMethod)]);
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

    // Billed covers
    const allBilledPkgNames = new Set([...Object.keys(dayOld.guest.packageCoversBilledByPackageName), ...Object.keys(dayNew.guest.packageCoversBilledByPackageName)]);
    allBilledPkgNames.forEach(name => {
        const delta = (dayNew.guest.packageCoversBilledByPackageName[name] || 0) - (dayOld.guest.packageCoversBilledByPackageName[name] || 0);
        if (delta !== 0) payload[`guests.packageCoversBilledByPackageName.${name}`] = increment(delta);
    });

    // --- Sales Delta ---
    const allSalesPkgNames = new Set([
      ...Object.keys(dayOld.sales.packageSalesAmountByName || {}),
      ...Object.keys(dayNew.sales.packageSalesAmountByName || {}),
    ]);
    allSalesPkgNames.forEach(name => {
        const amountDelta = (dayNew.sales.packageSalesAmountByName[name] || 0) - (dayOld.sales.packageSalesAmountByName[name] || 0);
        const qtyDelta = (dayNew.sales.packageSalesQtyByName[name] || 0) - (dayOld.sales.packageSalesQtyByName[name] || 0);
        if(amountDelta !== 0) payload[`sales.packageSalesAmountByName.${name}`] = increment(amountDelta);
        if(qtyDelta !== 0) payload[`sales.packageSalesQtyByName.${name}`] = increment(qtyDelta);
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
      if (qtyDelta === 0 && amtDelta === 0) return;

      const cat = safeKey(newItem?.categoryName ?? oldItem?.categoryName ?? "Uncategorized");
      catQtyDelta[cat] = (catQtyDelta[cat] ?? 0) + qtyDelta;
      catAmtDelta[cat] = (catAmtDelta[cat] ?? 0) + amtDelta;
    });

    for (const [cat, qd] of Object.entries(catQtyDelta)) {
      if (qd !== 0) payload[`sales.addonSalesQtyByCategory.${cat}`] = increment(qd);
    }
    for (const [cat, ad] of Object.entries(catAmtDelta)) {
      if (ad !== 0) payload[`sales.addonSalesAmountByCategory.${cat}`] = increment(ad);
    }

    const dayRef = dailyAnalyticsDocRef(db, storeId, dayId);
    const monthId = dayId.slice(0, 6);
    const yearId = dayId.slice(0, 4);
    const monthRef = doc(db, "stores", storeId, "analyticsMonths", monthId);
    const yearRef  = doc(db, "stores", storeId, "analyticsYears", yearId);

    allAddonItems.forEach((itemName) => {
      const oldItem = dayOld.sales.addonSalesByItem?.[itemName];
      const newItem = dayNew.sales.addonSalesByItem?.[itemName];

      const qtyDelta = (newItem?.qty || 0) - (oldItem?.qty || 0);
      const amountDelta = (newItem?.amount || 0) - (oldItem?.amount || 0);
      if (qtyDelta === 0 && amountDelta === 0) return;

      const categoryName = newItem?.categoryName ?? oldItem?.categoryName ?? "Uncategorized";
      const itemId = toSafeDocId(itemName);

      const write = (parent: any) => {
        const itemRef = doc(parent, "addonItems", itemId);
        batch.set(
          itemRef,
          {
            itemName,
            categoryName,
            qty: increment(qtyDelta),
            amount: increment(amountDelta),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      };

      write(dayRef);
      write(monthRef);
      write(yearRef);
    });

    // --- Peak Hour Delta ---
    if (dayOld.peak.hourKey !== dayNew.peak.hourKey) {
        if(dayOld.peak.hourKey && dayOld.peak.count > 0) {
          payload[`sales.salesAmountByHour.${dayOld.peak.hourKey}`] = increment(-dayOld.peak.amount);
          payload[`sales.sessionCountByHour.${dayOld.peak.hourKey}`] = increment(-dayOld.peak.count);
        }
        const newNew = dayNew as any; // temp fix for typescript
        if(newNew.peak.hourKey && dayNew.peak.count > 0) {
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

    const allRefillNames = new Set([
      ...Object.keys(dayOld.refill?.servedRefillsByName || {}),
      ...Object.keys(dayNew.refill?.servedRefillsByName || {}),
    ]);
    
    allRefillNames.forEach((refillName) => {
      const oldQty = (dayOld.refill?.servedRefillsByName?.[refillName] ?? 0) as number;
      const newQty = (dayNew.refill?.servedRefillsByName?.[refillName] ?? 0) as number;
    
      const qtyDelta = newQty - oldQty;
      if (qtyDelta === 0) return;
    
      const refillId = toSafeDocId(refillName);
    
      const write = (parent: any) => {
        const rRef = doc(parent, "refillItems", refillId);
        batch.set(
          rRef,
          {
            refillName,
            qty: increment(qtyDelta),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      };
    
      write(dayRef);
      write(monthRef);
      write(yearRef);
    });
    
    batch.set(dayRef, payload, { merge: true });

    // ---- NEW: Month + Year rollups ----
    const basePayload: Record<string, any> = { ...payload };
    delete basePayload["meta.dayId"];
    delete basePayload["meta.dayStartMs"];

    // Month doc
    batch.set(
      monthRef,
      {
        ...basePayload,
        "meta.monthId": monthId,
        "meta.updatedAt": serverTimestamp(),
      },
      { merge: true }
    );

    // Year doc
    batch.set(
      yearRef,
      {
        ...basePayload,
        "meta.yearId": yearId,
        "meta.updatedAt": serverTimestamp(),
      },
      { merge: true }
    );
  }

  // If caller gave us a batch, THEY will commit.
  if (externalBatch) return;

  try {
    await batch.commit();
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
