
'use client';

import {
  type Firestore,
  type WriteBatch,
  type Transaction,
  increment,
  serverTimestamp,
  doc,
} from 'firebase/firestore';
import type { KitchenTicket } from '@/lib/types';
import { getDayIdFromTimestamp, getKitchenTicketContribution } from './daily';

type Writer =
  | { kind: "tx"; tx: Transaction }
  | { kind: "batch"; batch: WriteBatch };

function writerSet(w: Writer, ref: any, data: any, opts: any) {
  if (w.kind === "tx") return w.tx.set(ref, data, opts);
  return w.batch.set(ref, data, opts);
}

/**
 * Calculates and applies the change (delta) for a KitchenTicket status update
 * to the daily, monthly, and yearly analytics documents.
 * This should be called within a transaction or batch to ensure atomicity.
 *
 * @param db The Firestore instance.
 * @param storeId The ID of the store.
 * @param oldTicket The ticket state *before* the change.
 * @param newTicket The ticket state *after* the change.
 * @param opts Object containing the Transaction or WriteBatch to use.
 */
export async function applyKitchenTicketAnalyticsDelta(
  db: Firestore,
  storeId: string,
  oldTicket: KitchenTicket,
  newTicket: KitchenTicket,
  opts: { tx?: Transaction; batch?: WriteBatch }
) {
  const w: Writer | null =
    opts?.tx ? { kind: "tx", tx: opts.tx } :
    opts?.batch ? { kind: "batch", batch: opts.batch } :
    null;

  if (!w) throw new Error("applyKitchenTicketAnalyticsDelta requires a tx or batch.");

  const oldContrib = getKitchenTicketContribution(oldTicket);
  const newContrib = getKitchenTicketContribution(newTicket);
  
  const dayId = newContrib.dayId || oldContrib.dayId;
  if (!dayId) {
    console.warn("[applyKitchenTicketAnalyticsDelta] No valid dayId found. Skipping.");
    return;
  }

  const deltaServed = newContrib.servedCount - oldContrib.servedCount;
  const deltaCancelled = newContrib.cancelledCount - oldContrib.cancelledCount;
  const deltaDurationSum = newContrib.durationMsSum - oldContrib.durationMsSum;
  const deltaDurationCount = newContrib.durationCount - oldContrib.durationCount;
  
  const typeKey = newContrib.typeKey || oldContrib.typeKey;

  if (deltaServed === 0 && deltaCancelled === 0 && deltaDurationSum === 0 && deltaDurationCount === 0) {
    return; // No change to apply
  }

  const payload: Record<string, any> = { "meta.updatedAt": serverTimestamp() };
  if (deltaServed !== 0) payload[`kitchen.servedCountByType.${typeKey}`] = increment(deltaServed);
  if (deltaCancelled !== 0) payload[`kitchen.cancelledCountByType.${typeKey}`] = increment(deltaCancelled);
  if (deltaDurationSum !== 0) payload[`kitchen.durationMsSumByType.${typeKey}`] = increment(deltaDurationSum);
  if (deltaDurationCount !== 0) payload[`kitchen.durationCountByType.${typeKey}`] = increment(deltaDurationCount);
  
  const monthId = dayId.slice(0, 6);
  const yearId = dayId.slice(0, 4);

  const dayRef = doc(db, "stores", storeId, "analytics", dayId);
  const monthRef = doc(db, "stores", storeId, "analyticsMonths", monthId);
  const yearRef = doc(db, "stores", storeId, "analyticsYears", yearId);

  // Apply to Daily
  writerSet(w, dayRef, { ...payload, "meta.dayId": dayId }, { merge: true });

  // Apply to Monthly
  writerSet(w, monthRef, { ...payload, "meta.monthId": monthId }, { merge: true });
  
  // Apply to Yearly
  writerSet(w, yearRef, { ...payload, "meta.yearId": yearId }, { merge: true });
}
