
"use client";

import {
  doc,
  increment,
  serverTimestamp,
  type Firestore,
  type Transaction,
  type WriteBatch,
} from "firebase/firestore";

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

function toSafeDocId(raw: string) {
  return encodeURIComponent(raw).replace(/%/g, "_").slice(0, 500);
}

function getDayIdManilaFromMs(ms: number) {
  // YYYYMMDD in Asia/Manila using Intl (no deps)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date(ms))
    .reduce((acc: any, p) => (p.type !== "literal" ? ((acc[p.type] = p.value), acc) : acc), {});
  return `${parts.year}${parts.month}${parts.day}`;
}

type KdsTicket = {
  status: "preparing" | "served" | "cancelled";
  type: "package" | "refill" | "addon";
  itemName?: string | null;
  createdAtClientMs?: number | null;
  servedAtClientMs?: number | null;
  durationMs?: number | null;
  refillName?: string | null; // Legacy, but keep for fallback
  qty?: number | null;        // optional, default 1
};

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

  const dayId = getDayIdManilaFromMs(ms);
  const monthId = dayId.slice(0, 6);
  const yearId = dayId.slice(0, 4);

  const sign = isServed ? +1 : -1; // entering served = +, leaving served = -

  const dayRef = doc(db, "stores", storeId, "analytics", dayId);
  const monthRef = doc(db, "stores", storeId, "analyticsMonths", monthId);
  const yearRef = doc(db, "stores", storeId, "analyticsYears", yearId);

  const ticket = isServed ? (newTicket as KdsTicket) : (oldTicket as KdsTicket);

  const typeKey = ticket.type;
  const dur = Number(ticket.durationMs ?? 0);
  const qty = Number(ticket.qty ?? 1);
  
  // Ensure docs exist by setting meta field. This is a safe "upsert".
  const dayStartMs = ms;
  writerSet(w, dayRef, { meta: { dayId, dayStartMs, storeId, updatedAt: serverTimestamp() } }, { merge: true });
  writerSet(w, monthRef, { meta: { monthId, storeId, updatedAt: serverTimestamp() } }, { merge: true });
  writerSet(w, yearRef, { meta: { yearId, storeId, updatedAt: serverTimestamp() } }, { merge: true });

  // Base kitchen counters
  const payload: Record<string, any> = {
    "meta.updatedAt": serverTimestamp(),
    [`kitchen.servedCountByType.${typeKey}`]: increment(sign * qty),
  };

  if (dur > 0) {
    payload[`kitchen.durationMsSumByType.${typeKey}`] = increment(sign * dur);
    payload[`kitchen.durationCountByType.${typeKey}`] = increment(sign * qty);
  }

  // Refill totals + refillItems subcollection
  if (typeKey === "refill") {
    payload["refills.servedRefillsTotal"] = increment(sign * qty);

    const refillName = (ticket.refillName ?? ticket.itemName ?? "Unknown").trim();
    if (refillName) {
        const refillId = toSafeDocId(refillName);

        const writeRefillItem = (parent: any) => {
        const rRef = doc(parent, "refillItems", refillId);
        writerSet(
            w,
            rRef,
            {
            refillName,
            qty: increment(sign * qty),
            updatedAt: serverTimestamp(),
            },
            { merge: true }
        );
        };

        writeRefillItem(dayRef);
        writeRefillItem(monthRef);
        writeRefillItem(yearRef);
    }
  }

  // Write to day/month/year using update
  writerUpdate(w, dayRef, payload);
  writerUpdate(w, monthRef, payload);
  writerUpdate(w, yearRef, payload);
}
