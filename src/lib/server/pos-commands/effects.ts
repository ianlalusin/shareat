import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";

/**
 * Deferred-effects outbox for financial commands (audit B17).
 *
 * Effects (analytics, KDS rollups, PIN archive, loyalty) are recorded as
 * `stores/{s}/posEffects/{effectId}` docs in the SAME transaction that writes
 * the canonical receipt / void, so a crash between "sale committed" and "effect
 * ran" can never lose the effect, and an effect can never exist for a sale that
 * was not committed. Ids are deterministic (`{sourceKey}__{effect}`), so a
 * replayed command rewrites the same doc instead of adding a second effect.
 *
 * Processing is idempotent and retryable: inline right after the command, and
 * by /api/cron/reconcile-pos-commands. Every run re-checks the source state
 * (receipt final / session voided) before running, and leaves the effect
 * pending — never "done" — when that state is missing.
 */

export type PosEffectKind =
  | "analytics"
  | "kdsAnalytics"
  | "rtKdsCleanup"
  | "pinFinalize"
  | "loyaltyFinalize"
  | "loyaltyEarn"
  | "loyaltyReverse"
  | "loyaltyReverseReceipt";

export type PosEffectSource =
  | { type: "receipt"; receiptId: string; commandId?: string | null }
  | { type: "voidedSession"; sessionId: string };

export type PosEffectSpec = {
  effect: PosEffectKind;
  payload: Record<string, unknown>;
};

export const MAX_EFFECT_ATTEMPTS = 10;

export function sourceKey(source: PosEffectSource): string {
  return source.type === "receipt" ? source.receiptId : `void_${source.sessionId}`;
}

export function effectId(source: PosEffectSource, effect: PosEffectKind, discriminator?: string): string {
  return `${sourceKey(source)}__${effect}${discriminator ? `__${discriminator}` : ""}`;
}

/** Writes the outbox docs inside the caller's transaction (writes only). */
export function queueEffectsInTx(
  db: Firestore,
  tx: Transaction,
  storeId: string,
  source: PosEffectSource,
  effects: Array<PosEffectSpec & { discriminator?: string }>,
  nowMs: number,
): string[] {
  const ids: string[] = [];
  for (const e of effects) {
    const id = effectId(source, e.effect, e.discriminator);
    tx.set(db.doc(`stores/${storeId}/posEffects/${id}`), {
      id,
      storeId,
      effect: e.effect,
      source,
      payload: e.payload,
      status: "pending",
      attempts: 0,
      createdAtMs: nowMs,
      createdAt: FieldValue.serverTimestamp(),
    });
    ids.push(id);
  }
  return ids;
}

export type EffectRunner = (args: {
  db: Firestore;
  storeId: string;
  effect: PosEffectKind;
  payload: Record<string, any>;
  source: PosEffectSource;
  effectDocId: string;
}) => Promise<void>;

/** True when the effect's source is committed in the state the effect needs. */
async function sourceIsFinal(
  db: Firestore,
  storeId: string,
  source: PosEffectSource,
  effect: PosEffectKind,
  payload: Record<string, any>,
): Promise<boolean> {
  if (source.type === "receipt") {
    const snap = await db.doc(`stores/${storeId}/receipts/${source.receiptId}`).get();
    if (!snap.exists) return false;
    const r = snap.data() as any;
    if (source.commandId && r.commandId !== source.commandId) return false;
    // A receipt-void reversal needs the void committed; everything else needs
    // a final (or later voided) receipt to exist.
    if (effect === "loyaltyReverseReceipt" && payload.reason === "receipt_void") return r.status === "voided";
    return r.status === "final" || r.status === "voided";
  }
  const snap = await db.doc(`stores/${storeId}/sessions/${source.sessionId}`).get();
  return snap.exists && (snap.data() as any)?.status === "voided";
}

export type EffectRunSummary = { done: number; pending: number; failed: number; skipped: number };

/**
 * Runs the given pending effects once. Never throws: failures are recorded on
 * the effect doc (`attempts`, `lastError`) and the effect stays pending until
 * MAX_EFFECT_ATTEMPTS, then becomes `failed` for a person to look at.
 */
export async function processEffects(
  db: Firestore,
  storeId: string,
  effectDocIds: string[],
  runner: EffectRunner,
  nowMs: number = Date.now(),
): Promise<EffectRunSummary> {
  const out: EffectRunSummary = { done: 0, pending: 0, failed: 0, skipped: 0 };
  for (const id of effectDocIds) {
    const ref = db.doc(`stores/${storeId}/posEffects/${id}`);
    const snap = await ref.get();
    if (!snap.exists) { out.skipped++; continue; }
    const e = snap.data() as any;
    if (e.status !== "pending") { out.skipped++; continue; }
    if (!(await sourceIsFinal(db, storeId, e.source, e.effect, e.payload ?? {}))) { out.pending++; continue; }
    try {
      await runner({ db, storeId, effect: e.effect, payload: e.payload ?? {}, source: e.source, effectDocId: id });
      await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        if (!cur.exists || (cur.data() as any).status !== "pending") return;
        tx.update(ref, { status: "done", doneAtMs: nowMs, attempts: Number((cur.data() as any).attempts || 0) + 1, lastError: null });
      });
      out.done++;
    } catch (err: any) {
      const attempts = Number(e.attempts || 0) + 1;
      const status = attempts >= MAX_EFFECT_ATTEMPTS ? "failed" : "pending";
      await db
        .runTransaction(async (tx) => {
          const cur = await tx.get(ref);
          if (!cur.exists || (cur.data() as any).status !== "pending") return;
          tx.update(ref, { status, attempts, lastError: String(err?.message || err).slice(0, 500), lastAttemptAtMs: nowMs });
        })
        .catch(() => {});
      if (status === "failed") out.failed++;
      else out.pending++;
    }
  }
  return out;
}

/** Pending effect ids for one store (cron sweep). */
export async function listPendingEffectIds(db: Firestore, storeId: string, limit = 200): Promise<string[]> {
  const snap = await db.collection(`stores/${storeId}/posEffects`).where("status", "==", "pending").limit(limit).get();
  return snap.docs.map((d: any) => d.id);
}
