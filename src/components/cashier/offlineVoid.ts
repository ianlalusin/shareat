"use client";

import { doc, getDoc } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/firebase/client";
import type { AppUser } from "@/context/auth-context";
import { stripUndefined } from "@/lib/firebase/utils";
import { getBrowserDeviceId } from "@/lib/offline/browserDevice";
import { addToQueue } from "@/lib/offline/payment-queue";
import { getOperatorSessionToken } from "@/lib/pos-commands/client";
import { writeOfflineCommand } from "@/components/cashier/offlinePayment";
import { writeActivityLog } from "@/components/cashier/activity-log";
import { computeSessionLabel } from "@/lib/utils/session";

/**
 * Records an offline session void as an immutable provisional command (audit
 * P1 / B16 / B17). Nothing canonical is written on the till: the queue item
 * (localStorage) is saved FIRST — if that fails the void is not taken — then
 * the create-only stores/{s}/posCommands/{opId} doc local-first. The server
 * voids the session on reconnect (/api/pos/commands/reconcile) only if it is
 * still open at the same revision, releases the table only if still seated by
 * it, and runs the PIN / loyalty reversals from its effects outbox.
 */
export async function voidSessionOffline(args: {
  storeId: string;
  sessionId: string;
  reason: string;
  actor: AppUser;
}): Promise<{ queued: boolean; opId: string | null }> {
  const { storeId, sessionId, reason, actor } = args;
  const safeReason = (reason ?? "").toString().trim();
  const [sessionSnap, activeProjectionSnap] = await Promise.all([
    getDoc(doc(db, "stores", storeId, "sessions", sessionId)),
    getDoc(doc(db, `stores/${storeId}/activeSessions`, sessionId)),
  ]);
  const sessionData = sessionSnap.exists() ? (sessionSnap.data() as any) : null;
  if (!sessionData || sessionData.status === "closed" || sessionData.status === "voided" || sessionData.isPaid) {
    return { queued: false, opId: null };
  }
  const projectionData: any = activeProjectionSnap.exists() ? activeProjectionSnap.data() : {};
  const opId = uuidv4();
  const now = Date.now();
  const command = stripUndefined({
    schema: 1,
    opId,
    kind: "voidSession",
    resolved: false,
    storeId,
    sessionId,
    terminalId: getBrowserDeviceId(),
    createdByUid: actor.uid,
    clientCreatedAtMs: now,
    operatorSessionToken: getOperatorSessionToken(storeId),
    expected: {
      sessionRevision: Number(sessionData.revision ?? 1),
      billingRevision: Number(sessionData.billingRevision ?? 0),
      tableId: sessionData.tableId && sessionData.tableId !== "alacarte" ? String(sessionData.tableId) : null,
      totalCents: 0,
    },
    payload: { reason: safeReason },
  });

  // Durable record #1 first (B17: the old code saved the marker AFTER the batch).
  addToQueue({
    storeId,
    sessionId,
    receiptId: sessionId,
    kind: "void",
    opId,
    command,
    ctx: {
      amount: 0,
      pin: projectionData.customerPin ? String(projectionData.customerPin) : null,
      redemptionIds: Array.isArray(sessionData.loyaltyRedemptions)
        ? sessionData.loyaltyRedemptions.map((r: any) => r.redemptionId).filter(Boolean)
        : [],
    },
    effects: { analytics: "skip", loyaltyFinalize: "skip", loyaltyEarn: "skip", loyaltyReverse: "skip", pinFinalize: "skip" },
  });
  // Durable record #2.
  writeOfflineCommand(storeId, opId, command);

  // Activity log is append-only and client-writable; fire-and-forget local-first.
  void writeActivityLog({
    storeId, sessionId, user: actor, action: "SESSION_VOIDED", reason: safeReason,
    sessionContext: {
      sessionStatus: "voided", sessionStartedAt: sessionData.startedAt,
      sessionMode: sessionData.sessionMode ?? undefined,
      customerName: sessionData.customer?.name ?? sessionData.customerName,
      tableNumber: sessionData.tableNumber,
      tableDisplayName: sessionData.tableDisplayName ?? null,
    },
    meta: { sessionLabel: computeSessionLabel(sessionData) },
  }).catch(() => {});

  return { queued: true, opId };
}
