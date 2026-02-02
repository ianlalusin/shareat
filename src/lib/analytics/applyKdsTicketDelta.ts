
'use client';

import {
  doc,
  increment,
  serverTimestamp,
  type Firestore,
  type Transaction,
  type WriteBatch,
} from "firebase/firestore";
import type { OrderItemStatus } from "@/lib/types";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { toJsDate } from "@/lib/utils/date";

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

type KdsTicket = {
  status: OrderItemStatus;
  type: "package" | "refill" | "addon";
  itemName?: string | null;
  kitchenLocationId?: string | null;
  createdAtClientMs?: number | null;
  servedAtClientMs?: number | null;
  cancelledAtClientMs?: number | null; // Added for completeness
  durationMs?: number | null;
  refillName?: string | null;
  qty?: number | null;
};

function safeKey(s: string) {
  return (s || "Uncategorized")
    .trim()
    .replace(/\./g, "·")     // dot is not allowed in field path
    .replace(/\//g, "∕");    // avoid slash confusion
}


export async function applyKdsTicketDelta(
  db: Firestore,
  storeId: string,
  oldTicket: KdsTicket | null,
  newTicket: KdsTicket | null,
  opts: { tx?: Transaction; batch?: WriteBatch }
) {
  const w: Writer | null =
    opts.tx ? { kind: "tx", tx: opts.tx } :
    opts.batch ? { kind: "batch", batch: opts.batch } :
    null;
  if (!w) throw new Error("applyKdsTicketDelta requires tx or batch.");

  const oldStatus = oldTicket?.status;
  const newStatus = newTicket?.status;

  if (oldStatus === newStatus) return; // No status change, no analytics delta.

  const ticketData = (newTicket || oldTicket);
  if (!ticketData) return; // Should not happen if status changed.

  let servedCountDelta = 0;
  let cancelledCountDelta = 0;
  let durationMsDelta = 0;
  let durationCountDelta = 0;
  let eventMs: number | null = null;
  
  // Determine the primary timestamp for the event
  if (newStatus === 'served') eventMs = newTicket?.servedAtClientMs ?? null;
  else if (newStatus === 'cancelled') eventMs = newTicket?.cancelledAtClientMs ?? null;
  else if (oldStatus === 'served') eventMs = oldTicket?.servedAtClientMs ?? null;
  else if (oldStatus === 'cancelled') eventMs = oldTicket?.cancelledAtClientMs ?? null;

  // Fallback to creation time if no terminal state timestamp is available
  eventMs = eventMs || ticketData.createdAtClientMs || toJsDate(Date.now())?.getTime();
  if (!eventMs) return; // Cannot determine the day for the analytics update.

  // --- Calculate Deltas ---
  if (oldStatus !== 'served' && newStatus === 'served') { // Just became served
    servedCountDelta = 1;
    const dur = Number(newTicket?.durationMs ?? 0);
    if (dur > 0) {
        durationMsDelta = dur;
        durationCountDelta = 1;
    }
  } else if (oldStatus === 'served' && newStatus !== 'served') { // No longer served (correction)
    servedCountDelta = -1;
    const dur = Number(oldTicket?.durationMs ?? 0);
    if (dur > 0) {
        durationMsDelta = -dur;
        durationCountDelta = -1;
    }
  }
  
  if (oldStatus !== 'cancelled' && newStatus === 'cancelled') { // Just became cancelled
    cancelledCountDelta = 1;
  } else if (oldStatus === 'cancelled' && newStatus !== 'cancelled') { // No longer cancelled (correction)
    cancelledCountDelta = -1;
  }

  // If no relevant analytics change occurred, exit.
  if (servedCountDelta === 0 && cancelledCountDelta === 0 && durationMsDelta === 0) {
    return;
  }

  // --- Prepare Update ---
  const dayId = getDayIdFromTimestamp(eventMs);
  const monthId = dayId.slice(0, 6);
  const yearId = dayId.slice(0, 4);

  const dayRef = doc(db, "stores", storeId, "analytics", dayId);
  const monthRef = doc(db, "stores", storeId, "analyticsMonths", monthId);
  const yearRef  = doc(db, "stores", storeId, "analyticsYears", yearId);

  const typeKey = ticketData.type || "unknown";
  const qty = Number(ticketData.qty ?? 1);

  // Ensure docs exist by setting meta field. This is a safe "upsert".
  const dayStartMs = eventMs;
  writerSet(w, dayRef, { meta: { dayId, dayStartMs, storeId, updatedAt: serverTimestamp() } }, { merge: true });
  writerSet(w, monthRef, { meta: { monthId, storeId, updatedAt: serverTimestamp() } }, { merge: true });
  writerSet(w, yearRef, { meta: { yearId, storeId, updatedAt: serverTimestamp() } }, { merge: true });
  
  const payload: Record<string, any> = {
    "meta.updatedAt": serverTimestamp(),
  };

  if (servedCountDelta !== 0) payload[`kitchen.servedCountByType.${typeKey}`] = increment(servedCountDelta * qty);
  if (cancelledCountDelta !== 0) payload[`kitchen.cancelledCountByType.${typeKey}`] = increment(cancelledCountDelta * qty);
  if (durationMsDelta !== 0) payload[`kitchen.durationMsSumByType.${typeKey}`] = increment(durationMsDelta);
  if (durationCountDelta !== 0) payload[`kitchen.durationCountByType.${typeKey}`] = increment(durationCountDelta);

  // Add location-specific analytics
  const locationId = ticketData.kitchenLocationId;
  if (locationId) {
    if (durationMsDelta !== 0) payload[`kitchen.durationMsSumByLocation.${locationId}`] = increment(durationMsDelta);
    if (durationCountDelta !== 0) payload[`kitchen.durationCountByLocation.${locationId}`] = increment(durationCountDelta);
  }
  
  // Refill totals (only applies if status changes to/from 'served')
  if (typeKey === "refill" && servedCountDelta !== 0) {
    payload["refills.servedRefillsTotal"] = increment(servedCountDelta * qty);
    const refillName = (ticketData.refillName ?? ticketData.itemName ?? "Unknown").trim();
    if (refillName) {
        payload[`refills.servedRefillsByName.${safeKey(refillName)}`] = increment(servedCountDelta * qty);
    }
  }

  // Write to day/month/year using update
  writerUpdate(w, dayRef, payload);
  writerUpdate(w, monthRef, payload);
  writerUpdate(w, yearRef, payload);
}
