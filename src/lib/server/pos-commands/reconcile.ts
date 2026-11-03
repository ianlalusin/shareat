import type { Firestore } from "firebase-admin/firestore";
import { PosCommandError, isTerminalConflict } from "@/lib/server/pos-commands/errors";
import { resolveOperator, type Operator } from "@/lib/server/pos-commands/operator";
import { checkoutInTx, isSafeId, type CheckoutTender, parseCheckoutInput } from "@/lib/server/pos-commands/checkout";
import { voidSessionInTx } from "@/lib/server/pos-commands/void-session";
import { processEffects, listPendingEffectIds, type EffectRunner } from "@/lib/server/pos-commands/effects";

/**
 * Offline command reconciliation (audit B16 / B17).
 *
 * An offline till records an immutable `stores/{s}/posCommands/{opId}` (and a
 * localStorage copy) instead of writing canonical docs. This applies it with the
 * same transaction as the online command plus the offline guards (expected
 * session revision, bill revision, recomputed total, table still seated by this
 * session). Business conflicts are recorded as `rejected` in
 * `posCommandResults/{opId}` and stay there for a manager (retry / dismiss);
 * transient failures throw so the caller retries.
 * Contract: docs/audit/pos-financial-commands.md §4.
 */

export type OfflineCommand = {
  schema: 1;
  opId: string;
  kind: "checkout" | "voidSession";
  storeId: string;
  sessionId: string;
  terminalId: string;
  createdByUid: string;
  clientCreatedAtMs: number;
  operatorSessionToken: string | null;
  expected: { sessionRevision: number; billingRevision: number; tableId: string | null; totalCents: number };
  payload: { payments?: CheckoutTender[]; receiptNumber?: string; receiptSeq?: number; reason?: string; lines?: any[] };
  /** false at creation; set true by the server once the command is resolved (sweep index). */
  resolved?: boolean;
  provisional?: Record<string, unknown> | null;
};

export type ReconcileCaller =
  | { type: "staff"; uid: string; role: string; isPlatformAdmin: boolean }
  | { type: "cron" };

export type ReconcileAction = "apply" | "retry" | "dismiss" | "accept-recorded";

export type ReconcileResult =
  | { status: "accepted"; replay: boolean; receiptId?: string; receiptNumber?: string; tableReleased: boolean }
  | { status: "rejected"; code: string; message: string }
  | { status: "dismissed"; note: string };

const bad = (m: string): never => {
  throw new PosCommandError("command_invalid", m, 400);
};

const int = (v: unknown, min = 0) => Number.isSafeInteger(v) && (v as number) >= min;

/** Validates a command's shape (from Firestore or a request body). */
export function parseOfflineCommand(raw: any, storeId: string, opId: string): OfflineCommand {
  if (!raw || typeof raw !== "object") bad("Invalid command.");
  if (raw.schema !== 1) bad("Unsupported command schema.");
  if (raw.opId !== opId || raw.storeId !== storeId) bad("Command id or store does not match.");
  if (raw.kind !== "checkout" && raw.kind !== "voidSession") bad("Unknown command kind.");
  if (!isSafeId(raw.sessionId) || !isSafeId(raw.createdByUid) || !isSafeId(raw.terminalId, 64)) bad("Invalid command ids.");
  if (!int(raw.clientCreatedAtMs, 1)) bad("Invalid command time.");
  if (raw.operatorSessionToken != null && (typeof raw.operatorSessionToken !== "string" || raw.operatorSessionToken.length > 2048)) {
    bad("Invalid operator session.");
  }
  const e = raw.expected;
  if (!e || !int(e.sessionRevision) || !int(e.billingRevision) || !int(e.totalCents)) bad("Invalid expected state.");
  if (e.tableId != null && !isSafeId(e.tableId)) bad("Invalid table id.");
  const p = raw.payload || {};
  if (raw.kind === "checkout") {
    if (typeof p.receiptNumber !== "string" || p.receiptNumber.length > 64 || !p.receiptNumber.includes("-OL-")) {
      bad("Invalid offline receipt number.");
    }
    if (!int(p.receiptSeq) || p.receiptSeq > 100000) bad("Invalid offline receipt sequence.");
    if (p.lines != null && (!Array.isArray(p.lines) || p.lines.length > 300)) bad("Invalid recorded lines.");
    // Reuses the online tender validation (finite whole-centavo amounts).
    parseCheckoutInput({
      storeId, sessionId: raw.sessionId, opId, payments: p.payments,
      expectedTotalCents: e.totalCents, billingRevision: e.billingRevision,
    });
  } else if (typeof p.reason !== "string" || !p.reason.trim() || p.reason.length > 500) {
    bad("A void reason is required.");
  }
  return raw as OfflineCommand;
}

async function creatorRole(db: Firestore, uid: string, storeId: string): Promise<{ role: string; isPlatformAdmin: boolean }> {
  const snap = await db.doc(`staff/${uid}`).get();
  if (!snap.exists) throw new PosCommandError("operator_session_invalid", "The staff account that took this offline sale no longer exists.", 409);
  const s = snap.data() as any;
  const role = String(s?.role || "");
  const isPlatformAdmin = role === "admin";
  const stores: string[] = Array.isArray(s?.assignedStoreIds) ? s.assignedStoreIds.map(String) : [];
  if (!isPlatformAdmin && !stores.includes(storeId)) {
    throw new PosCommandError("operator_session_invalid", "The staff account that took this offline sale has no access to this store.", 409);
  }
  if (!["admin", "manager", "cashier"].includes(role)) {
    throw new PosCommandError("operator_session_invalid", "This staff role cannot settle bills.", 409);
  }
  return { role, isPlatformAdmin };
}

export type ReconcileDeps = {
  now?: number;
  key?: Buffer | null; // test seam for the profile-session key
  runner?: EffectRunner; // effects processed inline when given
};

export async function reconcileCommand(
  db: Firestore,
  args: {
    storeId: string;
    opId: string;
    caller: ReconcileCaller;
    bodyCommand?: unknown;
    action?: ReconcileAction;
    note?: string;
    /** The approving manager's verified local profile (accept-recorded). */
    approverProfileId?: string | null;
  },
  deps: ReconcileDeps = {},
): Promise<ReconcileResult> {
  const { storeId, opId, caller } = args;
  const action = args.action ?? "apply";
  const now = deps.now ?? Date.now();
  if (!isSafeId(storeId) || !isSafeId(opId, 64)) bad("Missing storeId or opId.");
  const cmdRef = db.doc(`stores/${storeId}/posCommands/${opId}`);
  const resultRef = db.doc(`stores/${storeId}/posCommandResults/${opId}`);
  const elevated = caller.type === "staff" && (caller.isPlatformAdmin || caller.role === "admin" || caller.role === "manager");

  /** Takes the command out of the cron sweep's unresolved index. */
  const markResolved = () =>
    db.runTransaction(async (tx) => {
      const cur = (await tx.get(cmdRef)) as any;
      if (cur.exists && cur.data()?.resolved !== true) tx.update(cmdRef, { resolved: true, resolvedAtMs: now });
    }).catch(() => {});

  // 1. The command: Firestore copy, else the caller's localStorage copy (the
  // Firestore create may have been denied or never synced). Persisted once.
  let cmdSnap = (await cmdRef.get()) as any;
  let command: OfflineCommand;
  if (cmdSnap.exists) {
    try {
      command = parseOfflineCommand(cmdSnap.data(), storeId, opId);
    } catch (e) {
      // A stored command that can never parse is terminal: record it as
      // rejected and take it out of the sweep index (re-review #7).
      const raw = cmdSnap.data() || {};
      const message = (e as any)?.message || "Malformed offline command.";
      await db.runTransaction(async (tx) => {
        const cur = (await tx.get(resultRef)) as any;
        if (cur.exists && ["accepted", "dismissed"].includes(cur.data()?.status)) return;
        tx.set(resultRef, {
          opId, kind: typeof raw.kind === "string" ? raw.kind.slice(0, 32) : "unknown", storeId,
          sessionId: typeof raw.sessionId === "string" ? raw.sessionId.slice(0, 128) : null,
          status: action === "dismiss" && elevated && typeof args.note === "string" && args.note.trim() ? "dismissed" : "rejected",
          code: "command_invalid", message, malformed: true,
          ...(action === "dismiss" && elevated ? { note: String(args.note || "").trim().slice(0, 500), dismissedByUid: (caller as any).uid } : {}),
          processedAtMs: now,
        });
      });
      await markResolved();
      return { status: "rejected", code: "command_invalid", message };
    }
  } else {
    if (!args.bodyCommand || caller.type !== "staff") {
      throw new PosCommandError("command_not_found", "Offline command has not reached the server yet.", 404);
    }
    command = parseOfflineCommand(args.bodyCommand, storeId, opId);
    if (command.createdByUid !== caller.uid) {
      throw new PosCommandError("forbidden", "Only the account that recorded this offline command can submit it.", 403);
    }
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(cmdRef)) as any;
      if (!cur.exists) tx.set(cmdRef, { ...command, resolved: false, persistedBy: "reconcile", persistedAtMs: now });
    });
    cmdSnap = await cmdRef.get();
    command = parseOfflineCommand(cmdSnap.data(), storeId, opId);
  }
  if (caller.type === "staff" && !elevated && command.createdByUid !== caller.uid) {
    throw new PosCommandError("forbidden", "Not your offline command.", 403);
  }

  // 2. Previous outcome.
  const prev = (await resultRef.get()) as any;
  const prevData = prev.exists ? prev.data() : null;
  if (prevData?.status === "accepted") {
    await markResolved();
    return { status: "accepted", replay: true, receiptId: prevData.receiptId, receiptNumber: prevData.receiptNumber, tableReleased: !!prevData.tableReleased };
  }
  if (prevData?.status === "dismissed") {
    await markResolved();
    return { status: "dismissed", note: String(prevData.note || "") };
  }
  if (action === "accept-recorded") {
    if (!elevated) throw new PosCommandError("forbidden", "Only a manager can accept an offline sale as recorded.", 403);
    const note = typeof args.note === "string" ? args.note.trim().slice(0, 500) : "";
    if (!note) bad("A resolution note is required.");
    if (prevData?.status !== "rejected") throw new PosCommandError("command_invalid", "Only a rejected offline sale can be accepted as recorded.", 409);
    const r = await acceptAsRecorded(
      db, command,
      { uid: (caller as any).uid, profileId: args.approverProfileId ?? null, note },
      now, deps.key,
    );
    if (deps.runner && r.effectIds.length) await processEffects(db, storeId, r.effectIds, deps.runner, now);
    await markResolved();
    return { status: "accepted", replay: r.replay, receiptId: r.receiptId, receiptNumber: r.receiptNumber, tableReleased: r.tableReleased };
  }
  if (action === "dismiss") {
    if (!elevated) throw new PosCommandError("forbidden", "Only a manager can dismiss an offline command.", 403);
    const note = typeof args.note === "string" ? args.note.trim().slice(0, 500) : "";
    if (!note) bad("A resolution note is required.");
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(resultRef)) as any;
      if (cur.exists && cur.data()?.status === "accepted") return;
      tx.set(resultRef, {
        opId, kind: command.kind, storeId, sessionId: command.sessionId,
        status: "dismissed", note, previous: cur.exists ? cur.data() : null,
        dismissedByUid: (caller as any).uid, processedAtMs: now,
      });
    });
    await markResolved();
    return { status: "dismissed", note };
  }
  if (prevData?.status === "rejected" && action !== "retry") {
    return { status: "rejected", code: String(prevData.code), message: String(prevData.message) };
  }

  // 3. Apply.
  const reject = async (e: PosCommandError): Promise<ReconcileResult> => {
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(resultRef)) as any;
      if (cur.exists && cur.data()?.status === "accepted") return;
      tx.set(resultRef, {
        opId, kind: command.kind, storeId, sessionId: command.sessionId,
        status: "rejected", code: e.code, message: e.message,
        attempts: Number(cur.exists ? cur.data()?.attempts || 0 : 0) + 1,
        processedAtMs: now, mode: "offline",
      });
    });
    // Rejected is terminal until a manager acts, so it leaves the sweep index.
    await markResolved();
    return { status: "rejected", code: e.code, message: e.message };
  };

  let operator: Operator;
  try {
    const { role, isPlatformAdmin } = await creatorRole(db, command.createdByUid, storeId);
    operator = await resolveOperator(db, {
      uid: command.createdByUid, role, isPlatformAdmin, storeId,
      token: command.operatorSessionToken, commandAtMs: command.clientCreatedAtMs, now,
      ...(deps.key !== undefined ? { key: deps.key } : {}),
    });
  } catch (e) {
    if (isTerminalConflict(e)) return reject(e as PosCommandError);
    throw e;
  }

  try {
    let accepted: ReconcileResult & { status: "accepted" };
    let effectIds: string[] = [];
    if (command.kind === "checkout") {
      const out = await db.runTransaction((tx) =>
        checkoutInTx(db, tx, {
          storeId, sessionId: command.sessionId, opId,
          payments: parseCheckoutInput({
            storeId, sessionId: command.sessionId, opId, payments: command.payload.payments,
            expectedTotalCents: command.expected.totalCents, billingRevision: command.expected.billingRevision,
          }).payments,
          expectedTotalCents: command.expected.totalCents,
          billingRevision: command.expected.billingRevision,
          offline: {
            receiptNumber: command.payload.receiptNumber as string,
            receiptSeq: command.payload.receiptSeq as number,
            terminalId: command.terminalId,
            sessionRevision: command.expected.sessionRevision,
            clientCreatedAtMs: command.clientCreatedAtMs,
          },
        }, operator, now),
      );
      effectIds = out.effectIds;
      accepted = { status: "accepted", replay: out.replay, receiptId: out.receiptId, receiptNumber: out.receiptNumber, tableReleased: out.tableReleased };
    } else {
      const out = await db.runTransaction((tx) =>
        voidSessionInTx(db, tx, {
          storeId, sessionId: command.sessionId, opId, reason: String(command.payload.reason).trim(),
          offline: { terminalId: command.terminalId, sessionRevision: command.expected.sessionRevision, clientCreatedAtMs: command.clientCreatedAtMs },
        }, operator, now),
      );
      effectIds = out.effectIds;
      accepted = { status: "accepted", replay: out.replay, tableReleased: out.tableReleased };
    }
    if (deps.runner && effectIds.length) await processEffects(db, storeId, effectIds, deps.runner, now);
    await markResolved();
    return accepted;
  } catch (e) {
    if (isTerminalConflict(e)) return reject(e as PosCommandError);
    throw e;
  }
}

/** Grace period before the cron takes over a command its till may still submit. */
export const SWEEP_GRACE_MS = 2 * 60 * 1000;

/** Cron sweep for one store: unreconciled commands, then pending effects. */
export async function sweepStore(
  db: Firestore,
  storeId: string,
  runner: EffectRunner,
  deps: { now?: number; key?: Buffer | null } = {},
): Promise<{ accepted: number; rejected: number; errors: number; effects: { done: number; pending: number; failed: number } }> {
  const now = deps.now ?? Date.now();
  const out = { accepted: 0, rejected: 0, errors: 0, effects: { done: 0, pending: 0, failed: 0 } };
  // Only unresolved commands (review #7): resolved and malformed ones leave the
  // index, and the sweep pages until a pass makes no progress (re-review #7),
  // so no fixed window can blind it. Grace uses server write time.
  const PAGE = 300;
  for (let round = 0; round < 20; round++) {
    const cmds = await db.collection(`stores/${storeId}/posCommands`).where("resolved", "==", false).limit(PAGE).get();
    let progressed = 0;
    for (const d of cmds.docs as any[]) {
      const writtenMs = typeof d.updateTime?.toMillis === "function" ? d.updateTime.toMillis() : 0;
      if (writtenMs > now - SWEEP_GRACE_MS) continue;
      try {
        const r = await reconcileCommand(db, { storeId, opId: d.id, caller: { type: "cron" } }, { now, runner, ...(deps.key !== undefined ? { key: deps.key } : {}) });
        if (r.status === "accepted") out.accepted++;
        else if (r.status === "rejected") out.rejected++;
        progressed++;
      } catch (e) {
        out.errors++;
        console.error(`[pos-commands] sweep ${storeId}/${d.id} failed:`, (e as any)?.message || e);
      }
    }
    if (progressed === 0 || cmds.docs.length < PAGE) break;
  }
  const pending = await listPendingEffectIds(db, storeId);
  if (pending.length) {
    const r = await processEffects(db, storeId, pending, runner, now);
    out.effects = { done: r.done, pending: r.pending, failed: r.failed };
  }
  return out;
}

/**
 * Manager-approved acceptance of a REJECTED offline sale (review #6,
 * re-review A/B/C). Money was taken at the till but the bill could not be
 * settled as recorded. Acceptance settles the session AS IT STANDS NOW with
 * the command's tenders through the normal checkout transaction (prices,
 * rewards, tenders and the time window validated; server receipt number; the
 * session closed atomically; refused if it was settled since). Guards:
 * approver is a different account AND operator than the recorder; the
 * recorder was a cashier+ with a verified operator session at record time;
 * no scan-to-pay / deposit tenders. The approval is written to the activity log.
 */
export async function acceptAsRecorded(
  db: Firestore,
  command: OfflineCommand,
  approver: { uid: string; profileId: string | null; note: string },
  now: number,
  key?: Buffer | null,
): Promise<{ receiptId: string; receiptNumber: string; replay: boolean; effectIds: string[]; tableReleased: boolean }> {
  const { storeId, opId } = command;
  const payments = command.payload.payments ?? [];
  if (command.kind !== "checkout") throw new PosCommandError("command_invalid", "Only offline sales can be accepted as recorded.", 409);
  if (payments.some((p) => p.intentDocId || p.fromReservationPaymentId)) {
    throw new PosCommandError("gateway_invalid", "Scan-to-pay or deposit tenders can't be accepted without verification.", 409);
  }
  if (approver.uid === command.createdByUid) {
    throw new PosCommandError("forbidden", "A different manager account must approve this offline sale.", 403);
  }
  const { role, isPlatformAdmin } = await creatorRole(db, command.createdByUid, storeId);
  const recorder = await resolveOperator(db, {
    uid: command.createdByUid, role, isPlatformAdmin, storeId,
    token: command.operatorSessionToken, commandAtMs: command.clientCreatedAtMs, now,
    ...(key !== undefined ? { key } : {}),
  });
  if (!recorder.verified) {
    throw new PosCommandError("forbidden", "This offline sale has no verified local user; it can only be dismissed.", 403);
  }
  if (approver.profileId && recorder.profileId === approver.profileId) {
    throw new PosCommandError("forbidden", "The person who took the sale cannot approve it.", 403);
  }
  const parsed = parseCheckoutInput({
    storeId, sessionId: command.sessionId, opId, payments,
    expectedTotalCents: command.expected.totalCents, billingRevision: command.expected.billingRevision,
  });
  const out = await db.runTransaction((tx) =>
    checkoutInTx(db, tx, {
      ...parsed,
      offline: {
        receiptNumber: String(command.payload.receiptNumber),
        receiptSeq: Number(command.payload.receiptSeq ?? 0),
        terminalId: command.terminalId,
        sessionRevision: command.expected.sessionRevision,
        clientCreatedAtMs: command.clientCreatedAtMs,
      },
      acceptRecorded: { byUid: approver.uid, byProfileId: approver.profileId, note: approver.note },
    }, recorder, now),
  );
  return { receiptId: out.receiptId, receiptNumber: out.receiptNumber, replay: out.replay, effectIds: out.effectIds, tableReleased: out.tableReleased };
}
