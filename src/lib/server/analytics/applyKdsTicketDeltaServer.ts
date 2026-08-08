import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { computeKdsTargets, kdsEventDayId, type KdsTicketLike } from "@/lib/analytics/kdsTargets";

// Admin-SDK port of src/lib/analytics/applyKdsTicketDelta.ts, but marker-based:
// it applies (target − stored marker) so it is idempotent and converges across
// partial serves, the client fallback, and repeated calls. The day/month/year
// kitchen.* / refills.* fields are written via set(merge)+increment (no presets,
// matching the original). Returns the new marker values for the caller to store
// on the ticket doc.

interface AnalyticsWriter {
  set(ref: any, data: any, options: any): unknown;
}

function safeKey(s: string) {
  return (s || "Uncategorized").trim().replace(/\./g, "·").replace(/\//g, "∕");
}

export type KdsServerActor = { profileId?: string | null; name?: string | null };

export type KdsMarkers = {
  analyticsServedQty: number;
  analyticsCancelledQty: number;
  analyticsDurationMs: number;
  analyticsDurationCount: number;
};

type KdsTicketDoc = KdsTicketLike & {
  kitchenLocationId?: string | null;
  refillName?: string | null;
  itemName?: string | null;
  analyticsServedQty?: number;
  analyticsCancelledQty?: number;
  analyticsDurationMs?: number;
  analyticsDurationCount?: number;
};

export function applyKdsTicketDeltaServer(
  db: Firestore,
  storeId: string,
  ticket: KdsTicketDoc,
  writer: AnalyticsWriter,
  now: Date = new Date(),
  actor?: KdsServerActor,
): { changed: boolean; markers: KdsMarkers } {
  const target = computeKdsTargets(ticket);
  const markers: KdsMarkers = {
    analyticsServedQty: target.servedQty,
    analyticsCancelledQty: target.cancelledQty,
    analyticsDurationMs: target.durationMs,
    analyticsDurationCount: target.durationCount,
  };

  const servedDelta = target.servedQty - Number(ticket.analyticsServedQty ?? 0);
  const cancelledDelta = target.cancelledQty - Number(ticket.analyticsCancelledQty ?? 0);
  const durationMsDelta = target.durationMs - Number(ticket.analyticsDurationMs ?? 0);
  const durationCountDelta = target.durationCount - Number(ticket.analyticsDurationCount ?? 0);

  if (servedDelta === 0 && cancelledDelta === 0 && durationMsDelta === 0 && durationCountDelta === 0) {
    return { changed: false, markers };
  }

  const dayId = kdsEventDayId(ticket, now);
  const monthId = dayId.slice(0, 6);
  const yearId = dayId.slice(0, 4);
  const typeKey = safeKey(String(ticket.type || "unknown"));
  const loc = ticket.kitchenLocationId ? safeKey(String(ticket.kitchenLocationId)) : null;
  const pid = actor?.profileId ? safeKey(String(actor.profileId)) : null;

  const kitchen: Record<string, any> = {};
  const setk = (bucket: string, key: string, v: number) => {
    if (v === 0) return;
    (kitchen[bucket] ??= {})[key] = FieldValue.increment(v);
  };
  setk("servedCountByType", typeKey, servedDelta);
  setk("cancelledCountByType", typeKey, cancelledDelta);
  setk("durationMsSumByType", typeKey, durationMsDelta);
  setk("durationCountByType", typeKey, durationCountDelta);
  if (loc) {
    setk("durationMsSumByLocation", loc, durationMsDelta);
    setk("durationCountByLocation", loc, durationCountDelta);
  }
  if (pid) {
    setk("servingMsSumByUser", pid, durationMsDelta);
    setk("servingCountByUser", pid, durationCountDelta);
  }

  const base: Record<string, any> = {};
  if (Object.keys(kitchen).length) base.kitchen = kitchen;
  if (pid && actor?.name && (durationMsDelta !== 0 || durationCountDelta !== 0)) {
    base.staffNames = { [pid]: String(actor.name) };
  }
  if (String(ticket.type) === "refill" && servedDelta !== 0) {
    const refillName = safeKey(String(ticket.refillName ?? ticket.itemName ?? "Unknown"));
    base.refills = {
      servedRefillsTotal: FieldValue.increment(servedDelta),
      servedRefillsByName: { [refillName]: FieldValue.increment(servedDelta) },
    };
  }

  const write = (ref: any, metaExtra: Record<string, any>) =>
    writer.set(ref, { ...base, meta: { storeId, updatedAt: FieldValue.serverTimestamp(), ...metaExtra } }, { merge: true });

  write(db.doc(`stores/${storeId}/analytics/${dayId}`), { dayId });
  write(db.doc(`stores/${storeId}/analyticsMonths/${monthId}`), { monthId });
  write(db.doc(`stores/${storeId}/analyticsYears/${yearId}`), { yearId });

  return { changed: true, markers };
}
