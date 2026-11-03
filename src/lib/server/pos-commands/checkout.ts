import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { calculateBillTotals } from "@/lib/tax";
import { servedQtyFields } from "@/lib/kitchen/served-qty";
import {
  planGatewayChecks,
  verifyBridgeTender,
  verifyReservationTender,
  type CheckoutPayment,
} from "@/components/cashier/gatewayTenders";
import {
  computeGuestCountSnapshot,
  computeSalesAnalytics,
  dropUndefined,
  formatReceiptNumber,
  strictCentavos,
  summarizeTenders,
} from "@/lib/checkout/receipt-math";
import { PosCommandError } from "@/lib/server/pos-commands/errors";
import { queueEffectsInTx, type PosEffectSpec } from "@/lib/server/pos-commands/effects";
import type { Operator } from "@/lib/server/pos-commands/operator";
import type { ModeOfPayment, SessionBillLine, Store } from "@/lib/types";

/**
 * Authoritative checkout (audit B01 / B03 / B16).
 *
 * One Admin-SDK transaction reads the session, its bill lines, the store's tax
 * config, payment methods and every referenced gateway payment, recomputes the
 * total, validates and consumes the tenders, and writes the receipt, session
 * close, table release and the deferred-effects outbox. The client never
 * supplies totals, receipt numbers or operator identity.
 * Contract: docs/audit/pos-financial-commands.md §3.1 / §4.
 */

export type CheckoutTender = {
  methodId: string;
  amount: number;
  reference?: string | null;
  intentDocId?: string | null;
  fromReservationPaymentId?: string | null;
};

export type OfflineCheckoutContext = {
  receiptNumber: string;
  receiptSeq: number;
  terminalId: string;
  sessionRevision: number;
  clientCreatedAtMs: number;
};

export type CheckoutInput = {
  storeId: string;
  sessionId: string;
  opId: string;
  payments: CheckoutTender[];
  expectedTotalCents: number;
  billingRevision: number;
  offline?: OfflineCheckoutContext | null;
};

export type CheckoutOutcome = {
  status: "accepted";
  replay: boolean;
  receiptId: string;
  receiptNumber: string;
  totalCents: number;
  tableReleased: boolean;
  effectIds: string[];
};

export const PAYMONGO_PROVIDER = "paymongo_qrph";

export function isSafeId(id: unknown, max = 128): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= max && !id.includes("/")
    && id !== "." && id !== ".." && !/^__.*__$/.test(id);
}

function invalid(message: string): never {
  throw new PosCommandError("command_invalid", message, 400);
}

const optStr = (v: unknown, max = 200): string | null => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || v.length > max) invalid("Invalid tender field.");
  return v as string;
};

/** Shape + money validation of a checkout body (no reads). */
export function parseCheckoutInput(body: any): CheckoutInput {
  if (!body || typeof body !== "object") invalid("Invalid body.");
  const { storeId, sessionId, opId } = body;
  if (!isSafeId(storeId) || !isSafeId(sessionId) || !isSafeId(opId, 64)) invalid("Missing storeId, sessionId or opId.");
  if (!Array.isArray(body.payments) || body.payments.length === 0 || body.payments.length > 20) invalid("Invalid payments.");
  const payments: CheckoutTender[] = body.payments.map((p: any) => {
    if (!p || typeof p !== "object" || !isSafeId(p.methodId)) invalid("Invalid tender method.");
    const cents = strictCentavos(p.amount);
    if (cents === null || cents <= 0) {
      throw new PosCommandError("tender_invalid", "Every tender amount must be a positive peso amount with at most two decimals.", 400);
    }
    const intentDocId = optStr(p.intentDocId, 128);
    if (intentDocId !== null && !isSafeId(intentDocId)) invalid("Invalid scan-to-pay tender.");
    return dropUndefined({
      methodId: p.methodId,
      amount: cents / 100,
      reference: optStr(p.reference),
      intentDocId,
      fromReservationPaymentId: optStr(p.fromReservationPaymentId, 128),
    });
  });
  const expectedTotalCents = body.expectedTotalCents;
  if (!Number.isSafeInteger(expectedTotalCents) || expectedTotalCents < 0) invalid("Invalid expectedTotalCents.");
  const billingRevision = body.billingRevision;
  if (!Number.isSafeInteger(billingRevision) || billingRevision < 0) invalid("Invalid billingRevision.");
  return { storeId, sessionId, opId, payments, expectedTotalCents, billingRevision };
}

type Snap = { exists: boolean; id: string; data: () => any };

/** Reads + validation + writes, inside the caller's transaction. */
export async function checkoutInTx(
  db: Firestore,
  tx: Transaction,
  input: CheckoutInput,
  operator: Operator,
  nowMs: number,
): Promise<CheckoutOutcome> {
  const { storeId, sessionId, opId, payments } = input;
  const base = `stores/${storeId}`;
  const resultRef = db.doc(`${base}/posCommandResults/${opId}`);
  const sessionRef = db.doc(`${base}/sessions/${sessionId}`);
  const receiptRef = db.doc(`${base}/receipts/${sessionId}`);
  const storeRef = db.doc(base);
  const settingsRef = db.doc(`${base}/receiptSettings/main`);
  const counterRef = db.doc(`${base}/counters/receipts`);
  const activeRef = db.doc(`${base}/activeSessions/${sessionId}`);
  const configRef = db.doc(`${base}/storeConfig/current`);

  // ---------- READS ----------
  const [resultSnap, sessionSnap, receiptSnap, storeSnap, settingsSnap, counterSnap, activeSnap, configSnap] =
    (await Promise.all([resultRef, sessionRef, receiptRef, storeRef, settingsRef, counterRef, activeRef, configRef].map((r) => tx.get(r)))) as unknown as Snap[];

  const replayFrom = (r: any): CheckoutOutcome => ({
    status: "accepted",
    replay: true,
    receiptId: String(r.receiptId ?? sessionId),
    receiptNumber: String(r.receiptNumber ?? ""),
    totalCents: Number(r.totalCents ?? Math.round(Number(r.total ?? 0) * 100)),
    tableReleased: !!r.tableReleased,
    effectIds: [],
  });
  if (resultSnap.exists && resultSnap.data()?.status === "accepted") return replayFrom(resultSnap.data());
  if (receiptSnap.exists && receiptSnap.data()?.commandId === opId) return replayFrom({ ...receiptSnap.data(), receiptId: sessionId });

  const session = sessionSnap.exists ? sessionSnap.data() : null;
  if (!session) throw new PosCommandError("session_not_found", "This bill no longer exists.", 404);
  if (session.status === "voided") throw new PosCommandError("session_voided", "This bill was voided.", 409);
  if (session.status === "closed" || session.isPaid === true || receiptSnap.exists) {
    throw new PosCommandError("already_settled", "This bill was already paid on another till.", 409);
  }
  if (input.offline && Number(session.revision ?? 1) !== input.offline.sessionRevision) {
    throw new PosCommandError("session_changed", "This bill changed on another till while offline.", 409);
  }
  if (Number(session.billingRevision ?? 0) !== input.billingRevision) {
    throw new PosCommandError("bill_changed", "Bill changed during payment. Review the bill and try again.", 409);
  }

  const linesSnap = await tx.get(db.collection(`${base}/sessions/${sessionId}/sessionBillLines`).orderBy("createdAt", "asc") as any) as any;
  const billLines = linesSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as SessionBillLine[];
  const ticketsSnap = await tx.get(db.collection(`${base}/sessions/${sessionId}/kitchentickets`) as any) as any;
  const tableId: string | null = session.tableId && session.tableId !== "alacarte" ? String(session.tableId) : null;
  const tableRef = tableId ? db.doc(`${base}/tables/${tableId}`) : null;
  const tableSnap = tableRef ? ((await tx.get(tableRef)) as unknown as Snap) : null;

  const paymentMethods: ModeOfPayment[] = (Array.isArray(configSnap.data()?.modesOfPayment) ? configSnap.data().modesOfPayment : [])
    .filter((m: any) => m && m.isActive !== false && !m.isArchived);
  for (const p of payments) {
    if (!paymentMethods.some((m) => m.id === p.methodId)) {
      throw new PosCommandError("tender_invalid", "A tender uses a payment method that is not enabled for this store.", 409);
    }
  }
  let gatewayChecks;
  try {
    gatewayChecks = planGatewayChecks(payments as CheckoutPayment[], paymentMethods);
  } catch (e: any) {
    throw new PosCommandError("gateway_invalid", e?.message || "Invalid scan-to-pay tender.", 409);
  }
  const intentReads: Array<{ check: any; ref: any; snap: Snap }> = [];
  let reservationRef: any = null;
  let reservationSnap: Snap | null = null;
  for (const check of gatewayChecks) {
    if (check.kind === "bridge") {
      const ref = db.doc(`${base}/paymentIntents/${check.intentDocId}`);
      intentReads.push({ check, ref, snap: (await tx.get(ref)) as unknown as Snap });
    } else if (!reservationRef && session.reservationId && isSafeId(String(session.reservationId))) {
      reservationRef = db.doc(`${base}/reservations/${String(session.reservationId)}`);
      reservationSnap = (await tx.get(reservationRef)) as unknown as Snap;
    }
  }

  // ---------- VALIDATION ----------
  const storeData = { id: storeId, ...(storeSnap.exists ? storeSnap.data() : {}) } as Store;
  const billDiscount = session.billDiscount ?? null;
  const customAdjustments = Array.isArray(session.customAdjustments) ? session.customAdjustments : [];
  const loyaltyRedemptions = Array.isArray(session.loyaltyRedemptions) ? session.loyaltyRedemptions : [];
  const totals = calculateBillTotals(
    billLines, storeData, billDiscount, customAdjustments,
    loyaltyRedemptions.map((r: any) => ({ type: r.type, value: r.value })),
  );
  const amountDue = totals.grandTotal;
  const amountDueCents = Math.round(Number(amountDue || 0) * 100);
  if (Math.abs(amountDueCents - input.expectedTotalCents) > 1) {
    throw new PosCommandError(
      "total_mismatch",
      `Bill changed before payment could be finalized. Review the bill and collect ₱${(amountDueCents / 100).toFixed(2)}.`,
      409,
    );
  }

  for (const { check, snap } of intentReads) {
    const bridge = snap.exists ? snap.data() : null;
    const problem = verifyBridgeTender(check, bridge, { storeId, sessionId });
    if (problem) throw new PosCommandError("gateway_invalid", problem, 409);
    if (bridge.provider != null && bridge.provider !== PAYMONGO_PROVIDER) {
      throw new PosCommandError("gateway_invalid", "Scan-to-pay payment came from a different provider.", 409);
    }
    if (bridge.currency != null && String(bridge.currency).toUpperCase() !== "PHP") {
      throw new PosCommandError("gateway_invalid", "Scan-to-pay payment is not in pesos.", 409);
    }
    if (bridge.billingRevision != null && Number(bridge.billingRevision) !== input.billingRevision) {
      throw new PosCommandError("gateway_invalid", "Scan-to-pay payment was made for an older version of this bill.", 409);
    }
    if (bridge.consumedByReceiptId != null && bridge.consumedByReceiptId !== sessionId) {
      throw new PosCommandError("gateway_consumed", "Scan-to-pay payment was already used on another receipt.", 409);
    }
    if (bridge.consumedByCommandId != null && bridge.consumedByCommandId !== opId) {
      throw new PosCommandError("gateway_consumed", "Scan-to-pay payment was already used.", 409);
    }
  }
  for (const check of gatewayChecks) {
    if (check.kind !== "reservation") continue;
    const problem = verifyReservationTender(check, reservationSnap?.exists ? reservationSnap.data() : null, { sessionId });
    if (problem) throw new PosCommandError("gateway_invalid", problem, 409);
  }

  let summary;
  try {
    summary = summarizeTenders({ payments, paymentMethods, amountDueCents });
  } catch (e: any) {
    throw new PosCommandError("tender_invalid", e?.message || "Invalid tenders.", 409);
  }

  // ---------- WRITES ----------
  const serverTs = FieldValue.serverTimestamp();
  const actor = {
    createdByUid: operator.uid,
    createdByUsername: operator.username,
    operatorProfileId: operator.profileId,
    operatorVerified: operator.verified,
  };

  payments.forEach((payment, i) => {
    const id = `${opId}_${i}`;
    tx.set(db.doc(`${base}/sessions/${sessionId}/payments/${id}`), dropUndefined({ ...payment, id, ...actor, commandId: opId, createdAt: serverTs }));
  });

  const kdsTicketIds: string[] = [];
  const rtStations: Record<string, Array<{ id: string; state: any }>> = {};
  for (const t of ticketsSnap.docs) {
    const old = t.data() as any;
    if (old.status !== "preparing" && old.status !== "ready") continue;
    const startMs = typeof old.createdAtClientMs === "number" ? old.createdAtClientMs : old.createdAt?.toMillis?.();
    const update = {
      status: "served",
      servedAt: serverTs,
      servedAtClientMs: nowMs,
      servedByUid: operator.uid,
      durationMs: startMs ? Math.max(0, nowMs - startMs) : 0,
      updatedAt: serverTs,
      ...servedQtyFields(old),
    };
    tx.update(t.ref, update);
    kdsTicketIds.push(t.id);
    if (old.kitchenLocationId) {
      (rtStations[old.kitchenLocationId] ??= []).push({
        id: t.id,
        state: dropUndefined({ ...old, ...update, id: t.id, servedAt: null, updatedAt: null, servedAtMs: nowMs }),
      });
    }
  }

  tx.update(sessionRef, {
    status: "closed",
    isPaid: true,
    closedByUid: operator.uid,
    closedByUsername: operator.username,
    closedByProfileId: operator.profileId,
    closedByCommandId: opId,
    closedAt: serverTs,
    closedAtClientMs: input.offline?.clientCreatedAtMs ?? nowMs,
    revision: Number(session.revision ?? 1) + 1,
    updatedAt: serverTs,
  });

  const projectionSource = activeSnap.exists ? activeSnap.data() : session;
  tx.set(db.doc(`${base}/closedSessions/${sessionId}`), {
    ...projectionSource,
    status: "closed",
    customerAccessEnabled: false,
    updatedAt: serverTs,
    closedAt: serverTs,
    closedAtClientMs: input.offline?.clientCreatedAtMs ?? nowMs,
  });
  if (activeSnap.exists) tx.delete(activeRef);

  let receiptNumber: string;
  let receiptSeq: number;
  let receiptNoFormat: string;
  if (input.offline) {
    receiptNumber = input.offline.receiptNumber;
    receiptSeq = input.offline.receiptSeq;
    receiptNoFormat = "OL";
  } else {
    receiptNoFormat = (settingsSnap.exists ? settingsSnap.data()?.receiptNoFormat : null) ?? "SELIP-######";
    receiptSeq = (counterSnap.exists ? Number(counterSnap.data()?.seq ?? 0) : 0) + 1;
    tx.set(counterRef, { seq: receiptSeq, updatedAt: serverTs }, { merge: true });
    receiptNumber = formatReceiptNumber(receiptNoFormat, receiptSeq);
  }

  const sales = computeSalesAnalytics(billLines, storeData);
  const createdAtClientMs = input.offline?.clientCreatedAtMs ?? nowMs;
  const receipt = dropUndefined({
    id: sessionId,
    receiptId: sessionId,
    storeId,
    sessionId,
    ...actor,
    commandId: opId,
    sessionMode: session.sessionMode,
    tableId: session.sessionMode === "alacarte" ? null : session.tableId ?? null,
    tableNumber: session.sessionMode === "alacarte" ? null : session.tableNumber ?? null,
    customerName: session.customer?.name ?? session.customerName ?? null,
    total: amountDue,
    totalPaid: summary.totalPaid,
    change: summary.change,
    status: "final",
    receiptSeq,
    receiptNumber,
    receiptNoFormatUsed: receiptNoFormat,
    createdAtClientMs,
    lines: billLines,
    billDiscount,
    customAdjustments,
    loyaltyRedemptions,
    ...(input.offline
      ? { offlineOrigin: true, offlineCommandId: opId, terminalId: input.offline.terminalId }
      : {}),
    analytics: {
      v: 2,
      sessionStartedAt: session.startedAt ?? session.createdAt ?? null,
      sessionStartedAtClientMs: session.startedAtClientMs ?? null,
      sessionStartedAtHour: new Date(session.startedAtClientMs ?? createdAtClientMs).getHours(),
      subtotal: totals.subtotal,
      discountsTotal: totals.totalDiscounts,
      chargesTotal: totals.chargesTotal,
      taxAmount: totals.taxTotal,
      vatableSales: totals.vatableSales,
      vatExemptSales: totals.vatExemptSales,
      grandTotal: totals.grandTotal,
      totalPaid: summary.totalPaid,
      change: summary.change,
      mop: summary.mopMap,
      salesByItem: sales.salesByItem,
      salesByCategory: sales.salesByCategory,
      servedRefillsByName: session.servedRefillsByName || {},
      serveCountByType: session.serveCountByType || {},
      serveTimeMsTotalByType: session.serveTimeMsTotalByType || {},
      guestCountSnapshot: computeGuestCountSnapshot(session, billLines, createdAtClientMs),
    },
    analyticsApplied: false,
    analyticsApplyId: opId,
  });
  tx.set(receiptRef, { ...receipt, createdAt: serverTs });

  // Table release: only if the table is still seated by THIS session, so an
  // old (offline) settlement can never clear a table another till re-seated.
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

  // Consume each gateway payment for this receipt, exactly once.
  for (const { ref } of intentReads) {
    tx.update(ref, { consumedByReceiptId: sessionId, consumedBySessionId: sessionId, consumedByCommandId: opId, consumedAtMs: nowMs });
  }
  if (reservationRef && reservationSnap?.exists) {
    tx.update(reservationRef, { paymentsAppliedToSessionId: sessionId, updatedAt: serverTs });
  }

  const projection = (activeSnap.exists ? activeSnap.data() : {}) as any;
  const pin = projection.customerPin ? String(projection.customerPin) : null;
  const phone = projection.linkedCustomerPhone || session.linkedCustomerPhone || null;
  const effects: PosEffectSpec[] = [
    { effect: "analytics", payload: { op: "payment", receiptId: sessionId } },
    { effect: "loyaltyFinalize", payload: { sessionId, receiptId: sessionId, actorUid: operator.uid } },
  ];
  if (kdsTicketIds.length) effects.push({ effect: "kdsAnalytics", payload: { sessionId, ticketIds: kdsTicketIds } });
  if (Object.keys(rtStations).length) effects.push({ effect: "rtKdsCleanup", payload: { sessionId, stations: rtStations } });
  if (pin) effects.push({ effect: "pinFinalize", payload: { sessionId, pin, reason: "payment_closed", actorUid: operator.uid } });
  if (phone) effects.push({ effect: "loyaltyEarn", payload: { sessionId, receiptId: sessionId, phone: String(phone), actorUid: operator.uid } });
  const effectIds = queueEffectsInTx(db, tx, storeId, { type: "receipt", receiptId: sessionId, commandId: opId }, effects, nowMs);

  const outcome: CheckoutOutcome = {
    status: "accepted",
    replay: false,
    receiptId: sessionId,
    receiptNumber,
    totalCents: amountDueCents,
    tableReleased,
    effectIds,
  };
  tx.set(resultRef, {
    opId,
    kind: "checkout",
    status: "accepted",
    storeId,
    sessionId,
    receiptId: sessionId,
    receiptNumber,
    totalCents: amountDueCents,
    tableReleased,
    mode: input.offline ? "offline" : "online",
    operatorUid: operator.uid,
    operatorProfileId: operator.profileId,
    processedAtMs: nowMs,
  });
  return outcome;
}

export function runCheckout(db: Firestore, input: CheckoutInput, operator: Operator, nowMs = Date.now()) {
  return db.runTransaction((tx) => checkoutInTx(db, tx, input, operator, nowMs));
}
