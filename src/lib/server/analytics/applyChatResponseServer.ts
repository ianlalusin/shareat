import "server-only";

import type { Firestore as AdminFirestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { resolveOnDutyAt, resolveOnDutySince, type PresenceEvent } from "@/lib/chat/presence";
import { computeFairResponseMs, isWithinStandard } from "@/lib/chat/responseTiming";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

type DayAgg = {
  responseMsSum: Record<string, number>;
  responseCount: Record<string, number>;
  within2Min: Record<string, number>;
  receivedWhileOnDuty: Record<string, number>;
  answeredWhileOnDuty: Record<string, number>;
  totalReceived: number;
  staffNames: Record<string, string>;
};

function emptyDayAgg(): DayAgg {
  return { responseMsSum: {}, responseCount: {}, within2Min: {}, receivedWhileOnDuty: {}, answeredWhileOnDuty: {}, totalReceived: 0, staffNames: {} };
}

function bump(rec: Record<string, number>, key: string, by = 1) {
  rec[key] = (rec[key] ?? 0) + by;
}

// Profile ids reach the rollups as Firestore field-path SEGMENTS
// (chat.responseCountByUser.<pid>), and respondedByProfileId arrives from the
// client. A dot in one would silently split into a nested path and a slash
// reads as a document boundary, so both are sanitized before use — the same
// per-module helper every other delta writer here keeps (applyKdsTicketDelta,
// applyKdsTicketDeltaServer, applyPaymentConversionServer).
function safeKey(s: string) {
  return (s || "Uncategorized")
    .trim()
    .replace(/\./g, "·")     // dot is not allowed in field path
    .replace(/\//g, "∕");    // avoid slash confusion
}

/**
 * Applies one staff reply's effect: re-derives each pending message's actual
 * state from Firestore (never trusts client-supplied timestamps for
 * scoring), stamps it, and returns the per-day rollup deltas to write.
 * Pure with respect to Firestore reads already performed by the caller
 * (`pendingMessages`, `presenceEvents`) — no I/O of its own, so it's callable
 * both inside a transaction and unit-tested directly.
 */
export function computeChatResponseDeltas(
  pendingMessages: { id: string; createdAtClientMs: number }[],
  presenceEvents: PresenceEvent[],
  respondedByProfileId: string,
  respondedByName: string,
  respondedAtClientMs: number,
): { stamps: Map<string, { responseMs: number; onDutyProfileIdAtArrival: string | null }>; dayAggs: Map<string, DayAgg> } {
  // Raw id for identity work (matching presence-log rows, comparing who's who);
  // sanitized id everywhere it becomes a field-path segment or a stamped value
  // that has to line up with those rollup keys.
  const responderOnDutyStart = resolveOnDutySince(presenceEvents, respondedByProfileId, respondedAtClientMs);
  const responderKey = safeKey(respondedByProfileId);
  const stamps = new Map<string, { responseMs: number; onDutyProfileIdAtArrival: string | null }>();
  const dayAggs = new Map<string, DayAgg>();

  for (const msg of pendingMessages) {
    const fairMs = computeFairResponseMs(msg.createdAtClientMs, responderOnDutyStart, respondedAtClientMs);
    const onDuty = resolveOnDutyAt(presenceEvents, msg.createdAtClientMs);
    stamps.set(msg.id, { responseMs: fairMs, onDutyProfileIdAtArrival: onDuty ? safeKey(onDuty.profileId) : null });

    const dayId = getDayIdFromTimestamp(msg.createdAtClientMs);
    const day = dayAggs.get(dayId) ?? emptyDayAgg();
    bump(day.responseMsSum, responderKey, fairMs);
    bump(day.responseCount, responderKey, 1);
    if (isWithinStandard(fairMs)) bump(day.within2Min, responderKey, 1);
    if (onDuty) {
      const onDutyKey = safeKey(onDuty.profileId);
      bump(day.receivedWhileOnDuty, onDutyKey, 1);
      // Compared on the RAW ids: that is the real identity test, independent of
      // whether two exotic ids happen to sanitize to the same key.
      if (onDuty.profileId === respondedByProfileId) bump(day.answeredWhileOnDuty, onDutyKey, 1);
      day.staffNames[onDutyKey] = onDuty.profileName;
    }
    day.totalReceived += 1;
    day.staffNames[responderKey] = respondedByName;
    dayAggs.set(dayId, day);
  }

  return { stamps, dayAggs };
}

/** Runs computeChatResponseDeltas against live reads inside a transaction and
 *  writes the stamps + rollup increments. Re-verifies each message is still
 *  an unanswered customer message before stamping (idempotent under a race
 *  between two staff replying to the same thread near-simultaneously).
 *
 *  The scoring instant is generated HERE, server-side, and never accepted from
 *  the caller: a client-supplied instant is both forgeable (an authenticated
 *  cashier could claim any timestamp and manufacture a perfect score) and
 *  silently wrong on a device with a skewed clock. Matches the sibling
 *  /api/analytics/kds-delta route, which likewise derives its own timing. */
export async function applyChatResponseServer(
  db: AdminFirestore,
  storeId: string,
  threadId: string,
  respondedByProfileId: string,
  respondedByName: string,
  pendingMessageIds: string[],
): Promise<{ stampedCount: number }> {
  // Taken once, outside the callback, so a transaction retry re-scores against
  // the same instant rather than drifting.
  const respondedAtMs = Date.now();
  // A repeated id in the array would otherwise be counted once per occurrence
  // by the loop below (inflating responseCount/within2Min/totalReceived) while
  // the stamps Map collapsed it to one — an inflated rollup from a single reply.
  const uniqueIds = [...new Set(pendingMessageIds)];
  return db.runTransaction(async (tx: Transaction) => {
    const msgRefs = uniqueIds.map((id) => db.doc(`stores/${storeId}/chatThreads/${threadId}/messages/${id}`));
    const msgSnaps = await Promise.all(msgRefs.map((r) => tx.get(r)));
    const pendingMessages = msgSnaps
      .map((snap) => (snap.exists ? { id: snap.id, data: snap.data() as any } : null))
      .filter((m): m is { id: string; data: any } => m != null && m.data.sender === "customer" && m.data.respondedAtClientMs == null)
      .map((m) => ({ id: m.id, createdAtClientMs: Number(m.data.createdAtClientMs) }));

    if (pendingMessages.length === 0) return { stampedCount: 0 };

    // Bounded: presence events are low-frequency (one per sign-in/out), so the
    // 500 most-recent events at-or-before this reply covers many weeks of
    // shift changes without an unbounded per-reply read as the log grows.
    const presenceQuery = db.collection(`stores/${storeId}/chatPresenceLog`)
      .where("atClientMs", "<=", respondedAtMs)
      .orderBy("atClientMs", "desc")
      .limit(500);
    const presenceSnap = await tx.get(presenceQuery);
    const presenceEvents: PresenceEvent[] = presenceSnap.docs.map((d) => d.data() as PresenceEvent);

    const { stamps, dayAggs } = computeChatResponseDeltas(
      pendingMessages, presenceEvents, respondedByProfileId, respondedByName, respondedAtMs,
    );

    const responderKey = safeKey(respondedByProfileId);
    for (const [id, stamp] of stamps) {
      tx.update(db.doc(`stores/${storeId}/chatThreads/${threadId}/messages/${id}`), {
        respondedAtClientMs: respondedAtMs,
        responseMs: stamp.responseMs,
        respondedByProfileId: responderKey,
        respondedByName,
        onDutyProfileIdAtArrival: stamp.onDutyProfileIdAtArrival,
      });
    }

    for (const [dayId, agg] of dayAggs) {
      const monthId = dayId.slice(0, 6);
      const yearId = dayId.slice(0, 4);
      const payload: Record<string, unknown> = { "meta.updatedAt": FieldValue.serverTimestamp() };
      // Keys arrive already sanitized from computeChatResponseDeltas; safeKey is
      // idempotent, so re-applying it here keeps the guard local to the line
      // that actually builds the field path.
      for (const [pid, v] of Object.entries(agg.responseMsSum)) payload[`chat.responseMsSumByUser.${safeKey(pid)}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.responseCount)) payload[`chat.responseCountByUser.${safeKey(pid)}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.within2Min)) payload[`chat.within2MinCountByUser.${safeKey(pid)}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.receivedWhileOnDuty)) payload[`chat.receivedWhileOnDutyByUser.${safeKey(pid)}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.answeredWhileOnDuty)) payload[`chat.answeredWhileOnDutyByUser.${safeKey(pid)}`] = FieldValue.increment(v);
      payload["chat.totalReceived"] = FieldValue.increment(agg.totalReceived);
      for (const [pid, name] of Object.entries(agg.staffNames)) payload[`staffNames.${safeKey(pid)}`] = name;

      for (const path of [
        `stores/${storeId}/analytics/${dayId}`,
        `stores/${storeId}/analyticsMonths/${monthId}`,
        `stores/${storeId}/analyticsYears/${yearId}`,
      ]) {
        tx.set(db.doc(path), { meta: { updatedAt: FieldValue.serverTimestamp() } }, { merge: true });
        tx.update(db.doc(path), payload);
      }
    }

    return { stampedCount: stamps.size };
  });
}
