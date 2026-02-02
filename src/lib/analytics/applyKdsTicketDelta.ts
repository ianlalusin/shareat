
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
  durationMs?: number | null;
  refillName?: string | null; // Legacy, but keep for fallback
  qty?: number | null;        // optional, default 1
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

  // Count only SERVED tickets
  const wasServed = oldTicket?.status === "served";
  const isServed = newTicket?.status === "served";
  if (wasServed === isServed) return;

  // Determine the dayId based on servedAtClientMs if available, else createdAtClientMs
  const ms =
    (wasServed ? oldTicket?.servedAtClientMs : newTicket?.servedAtClientMs) ??
    (wasServed ? oldTicket?.createdAtClientMs : newTicket?.createdAtClientMs) ??
    Date.now();

  const dayId = getDayIdFromTimestamp(ms);
  const monthId = dayId.slice(0, 6);
  const yearId = dayId.slice(0, 4);

  const sign = isServed ? +1 : -1; // entering served = +, leaving served = -

  const dayRef = doc(db, "stores", storeId, "analytics", dayId);
  const monthRef = doc(db, "stores", storeId, "analyticsMonths", monthId);
  const yearRef = doc(db, "stores", storeId, "analyticsYears", yearId);

  const ticket = sign > 0 ? (newTicket as KdsTicket) : (oldTicket as KdsTicket);

  const typeKey = ticket.type;
  const dur = Number(ticket.durationMs ?? 0);
  const qty = Number(ticket.qty ?? 1);
  const locationId = ticket.kitchenLocationId;
  
  // Ensure docs exist by setting meta field. This is a safe "upsert".
  const dayStartMs = ms;
  writerSet(w, dayRef, { meta: { dayId, dayStartMs, storeId, updatedAt: serverTimestamp() } }, { merge: true });
  writerSet(w, monthRef, { meta: { monthId, storeId, updatedAt: serverTimestamp() } }, { merge: true });
  writerSet(w, yearRef, { meta: { yearId, storeId, updatedAt: serverTimestamp() } }, { merge: true });

  // Base kitchen counters
  const payload: Record<string, any> = {
    "meta.updatedAt": serverTimestamp(),
    [`kitchen.servedCountByType.${typeKey}`]: increment(sign * qty),
    [`kitchen.durationCountByType.${typeKey}`]: increment(sign * qty),
    [`kitchen.durationMsSumByType.${typeKey}`]: increment(sign * dur),
  };
  
  // Add location-specific analytics
  if (locationId) {
    payload[`kitchen.durationMsSumByLocation.${locationId}`] = increment(sign * dur);
    payload[`kitchen.durationCountByLocation.${locationId}`] = increment(sign * qty);
  }
  
  // Refill totals + refillItems map update
  if (typeKey === "refill") {
    payload["refills.servedRefillsTotal"] = increment(sign * qty);

    const refillName = (ticket.refillName ?? ticket.itemName ?? "Unknown").trim();
    if (refillName) {
        payload[`refills.servedRefillsByName.${safeKey(refillName)}`] = increment(sign * qty);
    }
  }

  // Write to day/month/year using update
  writerUpdate(w, dayRef, payload);
  writerUpdate(w, monthRef, payload);
  writerUpdate(w, yearRef, payload);
}
