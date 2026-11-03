import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { PosCommandError } from "@/lib/server/pos-commands/errors";
import { queueEffectsInTx, type PosEffectSpec } from "@/lib/server/pos-commands/effects";
import { isSafeId } from "@/lib/server/pos-commands/checkout";
import { OFFLINE_CLOCK_SKEW_MS, type Operator } from "@/lib/server/pos-commands/operator";

/**
 * Void an open (unpaid) session — server command replacing the client
 * voidSession / voidSessionOffline batches (audit B01 / B16 / B17).
 * Effects (PIN archive, loyalty reversal, KDS display cleanup) go to the
 * outbox in the same transaction.
 */
export type VoidSessionInput = {
  storeId: string;
  sessionId: string;
  opId: string;
  reason: string;
  offline?: { terminalId: string; sessionRevision: number; clientCreatedAtMs: number } | null;
};

export type VoidSessionOutcome = { status: "accepted"; replay: boolean; tableReleased: boolean; effectIds: string[] };

export function parseVoidSessionInput(body: any): VoidSessionInput {
  if (!body || typeof body !== "object") throw new PosCommandError("command_invalid", "Invalid body.");
  const { storeId, sessionId, opId } = body;
  if (!isSafeId(storeId) || !isSafeId(sessionId) || !isSafeId(opId, 64)) {
    throw new PosCommandError("command_invalid", "Missing storeId, sessionId or opId.");
  }
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!reason) throw new PosCommandError("command_invalid", "A void reason is required.");
  return { storeId, sessionId, opId, reason };
}

export async function voidSessionInTx(
  db: Firestore,
  tx: Transaction,
  input: VoidSessionInput,
  operator: Operator,
  nowMs: number,
): Promise<VoidSessionOutcome> {
  const { storeId, sessionId, opId } = input;
  const base = `stores/${storeId}`;
  const resultRef = db.doc(`${base}/posCommandResults/${opId}`);
  const sessionRef = db.doc(`${base}/sessions/${sessionId}`);
  const activeRef = db.doc(`${base}/activeSessions/${sessionId}`);

  const [resultSnap, sessionSnap, activeSnap] = (await Promise.all([resultRef, sessionRef, activeRef].map((r) => tx.get(r)))) as any[];
  if (resultSnap.exists) {
    const r = resultSnap.data();
    // An opId is bound to one command (audit P1 review #10).
    if (r?.kind !== "voidSession" || r?.sessionId !== sessionId) {
      throw new PosCommandError("command_conflict", "This command id was already used for a different action.", 409);
    }
    if (r?.status === "accepted") return { status: "accepted", replay: true, tableReleased: !!r?.tableReleased, effectIds: [] };
  }
  const session = sessionSnap.exists ? sessionSnap.data() : null;
  if (!session) throw new PosCommandError("session_not_found", "This bill no longer exists.", 404);
  if (session.status === "voided") {
    if (session.voidedByCommandId === opId) return { status: "accepted", replay: true, tableReleased: false, effectIds: [] };
    throw new PosCommandError("session_voided", "This bill was already voided.", 409);
  }
  if (session.status === "closed" || session.isPaid === true) {
    throw new PosCommandError("already_settled", "This bill was paid; it cannot be voided.", 409);
  }
  if (input.offline && Number(session.revision ?? 1) !== input.offline.sessionRevision) {
    throw new PosCommandError("session_changed", "This bill changed on another till while offline.", 409);
  }
  if (input.offline) {
    const at = input.offline.clientCreatedAtMs;
    const started = Number(session.startedAtClientMs ?? 0);
    if (at > nowMs + OFFLINE_CLOCK_SKEW_MS || (started > 0 && at < started - OFFLINE_CLOCK_SKEW_MS)) {
      throw new PosCommandError("command_time_invalid", "The offline void time is outside this bill's open period.", 409);
    }
  }
  // Rewards to hand back: only redemptions the server recorded as applied to
  // THIS bill (audit P1 review #5) — the session array is client-visible.
  const claimed: string[] = Array.isArray(session.loyaltyRedemptions)
    ? [...new Set<string>(session.loyaltyRedemptions.map((r: any) => r?.redemptionId).filter((x: unknown): x is string => isSafeId(x)))]
    : [];
  const redemptionSnaps = claimed.length ? ((await tx.getAll(...claimed.map((id) => db.doc(`loyaltyRedemptions/${id}`)))) as any[]) : [];
  const ticketsSnap = (await tx.get(db.collection(`${base}/sessions/${sessionId}/kitchentickets`) as any)) as any;
  const tableId: string | null = session.tableId && session.tableId !== "alacarte" ? String(session.tableId) : null;
  const tableRef = tableId ? db.doc(`${base}/tables/${tableId}`) : null;
  const tableSnap = tableRef ? ((await tx.get(tableRef)) as any) : null;

  const serverTs = FieldValue.serverTimestamp();
  const rtStations: Record<string, Array<{ id: string; state: any }>> = {};
  for (const t of ticketsSnap.docs) {
    const old = t.data() as any;
    if (old.status !== "preparing" && old.status !== "ready") continue;
    const update = {
      status: "cancelled",
      cancelledAt: serverTs,
      cancelledAtClientMs: nowMs,
      cancelledByUid: operator.uid,
      cancelReason: "Session Voided",
      updatedAt: serverTs,
    };
    tx.update(t.ref, update);
    if (old.kitchenLocationId) {
      (rtStations[old.kitchenLocationId] ??= []).push({
        id: t.id,
        state: { ...old, ...update, id: t.id, cancelledAt: null, updatedAt: null },
      });
    }
  }

  tx.update(sessionRef, {
    status: "voided",
    voidedAt: serverTs,
    voidedAtClientMs: input.offline?.clientCreatedAtMs ?? nowMs,
    voidedByUid: operator.uid,
    voidedByUsername: operator.username,
    voidedByProfileId: operator.profileId,
    voidedByCommandId: opId,
    voidReason: input.reason,
    revision: Number(session.revision ?? 1) + 1,
    updatedAt: serverTs,
    ...(input.offline ? { offlineOrigin: true } : {}),
  });

  if (activeSnap.exists) {
    tx.set(db.doc(`${base}/closedSessions/${sessionId}`), {
      ...activeSnap.data(),
      status: "voided",
      customerAccessEnabled: false,
      updatedAt: serverTs,
      closedAt: serverTs,
    });
    tx.delete(activeRef);
  }

  let tableReleased = false;
  if (tableRef && tableSnap?.exists && tableSnap.data()?.currentSessionId === sessionId) {
    tx.update(tableRef, { status: "available", currentSessionId: null, closedSessionId: sessionId, updatedAt: serverTs });
    tx.set(db.doc(`${base}/storeConfig/current/tables/${tableId}`), {
      status: "available",
      currentSessionId: null,
      customerName: null,
      packageLabel: null,
      sessionType: null,
      guestCount: null,
      itemCount: null,
      startedAtMs: null,
      updatedAt: serverTs,
    }, { merge: true });
    tableReleased = true;
  }

  const projection = (activeSnap.exists ? activeSnap.data() : {}) as any;
  const pin = projection.customerPin ? String(projection.customerPin) : null;
  const redemptionIds: string[] = claimed.filter((_, i) => {
    const r = redemptionSnaps[i]?.exists ? redemptionSnaps[i].data() : null;
    return !!r && r.appliedStoreId === storeId && r.appliedSessionId === sessionId && !r.appliedReceiptId;
  });
  const effects: PosEffectSpec[] = [];
  if (pin) effects.push({ effect: "pinFinalize", payload: { sessionId, pin, reason: "session_voided", actorUid: operator.uid } });
  if (redemptionIds.length) effects.push({ effect: "loyaltyReverse", payload: { sessionId, redemptionIds, actorUid: operator.uid } });
  if (Object.keys(rtStations).length) effects.push({ effect: "rtKdsCleanup", payload: { sessionId, stations: rtStations } });
  const effectIds = queueEffectsInTx(db, tx, storeId, { type: "voidedSession", sessionId }, effects, nowMs);

  tx.set(resultRef, {
    opId,
    kind: "voidSession",
    status: "accepted",
    storeId,
    sessionId,
    tableReleased,
    mode: input.offline ? "offline" : "online",
    operatorUid: operator.uid,
    operatorProfileId: operator.profileId,
    processedAtMs: nowMs,
  });
  return { status: "accepted", replay: false, tableReleased, effectIds };
}

export function runVoidSession(db: Firestore, input: VoidSessionInput, operator: Operator, nowMs = Date.now()) {
  return db.runTransaction((tx) => voidSessionInTx(db, tx, input, operator, nowMs));
}
