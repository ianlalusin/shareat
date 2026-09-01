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
  const responderOnDutyStart = resolveOnDutySince(presenceEvents, respondedByProfileId, respondedAtClientMs);
  const stamps = new Map<string, { responseMs: number; onDutyProfileIdAtArrival: string | null }>();
  const dayAggs = new Map<string, DayAgg>();

  for (const msg of pendingMessages) {
    const fairMs = computeFairResponseMs(msg.createdAtClientMs, responderOnDutyStart, respondedAtClientMs);
    const onDuty = resolveOnDutyAt(presenceEvents, msg.createdAtClientMs);
    stamps.set(msg.id, { responseMs: fairMs, onDutyProfileIdAtArrival: onDuty?.profileId ?? null });

    const dayId = getDayIdFromTimestamp(msg.createdAtClientMs);
    const day = dayAggs.get(dayId) ?? emptyDayAgg();
    bump(day.responseMsSum, respondedByProfileId, fairMs);
    bump(day.responseCount, respondedByProfileId, 1);
    if (isWithinStandard(fairMs)) bump(day.within2Min, respondedByProfileId, 1);
    if (onDuty) {
      bump(day.receivedWhileOnDuty, onDuty.profileId, 1);
      if (onDuty.profileId === respondedByProfileId) bump(day.answeredWhileOnDuty, onDuty.profileId, 1);
      day.staffNames[onDuty.profileId] = onDuty.profileName;
    }
    day.totalReceived += 1;
    day.staffNames[respondedByProfileId] = respondedByName;
    dayAggs.set(dayId, day);
  }

  return { stamps, dayAggs };
}

/** Runs computeChatResponseDeltas against live reads inside a transaction and
 *  writes the stamps + rollup increments. Re-verifies each message is still
 *  an unanswered customer message before stamping (idempotent under a race
 *  between two staff replying to the same thread near-simultaneously). */
export async function applyChatResponseServer(
  db: AdminFirestore,
  storeId: string,
  threadId: string,
  respondedByProfileId: string,
  respondedByName: string,
  respondedAtClientMs: number,
  pendingMessageIds: string[],
): Promise<{ stampedCount: number }> {
  return db.runTransaction(async (tx: Transaction) => {
    const msgRefs = pendingMessageIds.map((id) => db.doc(`stores/${storeId}/chatThreads/${threadId}/messages/${id}`));
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
      .where("atClientMs", "<=", respondedAtClientMs)
      .orderBy("atClientMs", "desc")
      .limit(500);
    const presenceSnap = await tx.get(presenceQuery);
    const presenceEvents: PresenceEvent[] = presenceSnap.docs.map((d) => d.data() as PresenceEvent);

    const { stamps, dayAggs } = computeChatResponseDeltas(
      pendingMessages, presenceEvents, respondedByProfileId, respondedByName, respondedAtClientMs,
    );

    for (const [id, stamp] of stamps) {
      tx.update(db.doc(`stores/${storeId}/chatThreads/${threadId}/messages/${id}`), {
        respondedAtClientMs,
        responseMs: stamp.responseMs,
        respondedByProfileId,
        respondedByName,
        onDutyProfileIdAtArrival: stamp.onDutyProfileIdAtArrival,
      });
    }

    for (const [dayId, agg] of dayAggs) {
      const monthId = dayId.slice(0, 6);
      const yearId = dayId.slice(0, 4);
      const payload: Record<string, unknown> = { "meta.updatedAt": FieldValue.serverTimestamp() };
      for (const [pid, v] of Object.entries(agg.responseMsSum)) payload[`chat.responseMsSumByUser.${pid}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.responseCount)) payload[`chat.responseCountByUser.${pid}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.within2Min)) payload[`chat.within2MinCountByUser.${pid}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.receivedWhileOnDuty)) payload[`chat.receivedWhileOnDutyByUser.${pid}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.answeredWhileOnDuty)) payload[`chat.answeredWhileOnDutyByUser.${pid}`] = FieldValue.increment(v);
      payload["chat.totalReceived"] = FieldValue.increment(agg.totalReceived);
      for (const [pid, name] of Object.entries(agg.staffNames)) payload[`staffNames.${pid}`] = name;

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
