import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { quoteRefund, normalizeQty } from "@/lib/analytics/refund-quote";
import { lineItemAmounts } from "@/lib/analytics/line-amounts";
import { roundMoney } from "@/lib/money";
import { receiptCorrectionTotals } from "@/lib/billing/receipt-correction";
import {
  computeSalesAnalytics,
  dropUndefined,
  settleTendersToTotal,
  strictCentavos,
} from "@/lib/checkout/receipt-math";
import { PosCommandError } from "@/lib/server/pos-commands/errors";
import { queueEffectsInTx } from "@/lib/server/pos-commands/effects";
import { isSafeId } from "@/lib/server/pos-commands/checkout";
import type { Operator } from "@/lib/server/pos-commands/operator";
import type { ModeOfPayment, Receipt, SessionBillLine, Store } from "@/lib/types";

/**
 * Server commands for already-issued receipts (audit B01): void, correction
 * (with the revision snapshot taken from the SERVER copy) and refund. They
 * replace the client writes in app/receipts/page.tsx, components/receipts/
 * page.tsx and createRefundReceipt. Each queues its analytics / loyalty
 * effects in the same transaction (docs/audit/pos-financial-commands.md §3.2).
 */

const invalid = (m: string): never => {
  throw new PosCommandError("command_invalid", m, 400);
};
const reasonOf = (v: unknown) => {
  const r = typeof v === "string" ? v.trim().slice(0, 500) : "";
  if (!r) invalid("A reason is required.");
  return r;
};

function cashPaidOf(receipt: any): number {
  let cash = 0;
  for (const [k, v] of Object.entries((receipt?.analytics?.mop ?? {}) as Record<string, number>)) {
    if (k.toLowerCase().includes("cash")) cash += Number(v || 0);
  }
  return roundMoney(cash);
}

// ---------------------------------------------------------------- void

export type ReceiptVoidInput = {
  storeId: string;
  receiptId: string;
  reason: string;
  disposition: "refunded" | "retained" | "partial" | null;
  refundedCents: number | null;
};

export function parseReceiptVoidInput(body: any): ReceiptVoidInput {
  if (!body || !isSafeId(body.storeId) || !isSafeId(body.receiptId)) invalid("Missing storeId or receiptId.");
  const disposition = body.voidCashDisposition ?? null;
  if (disposition !== null && !["refunded", "retained", "partial"].includes(disposition)) invalid("Invalid cash disposition.");
  let refundedCents: number | null = null;
  if (disposition === "partial") {
    refundedCents = strictCentavos(body.voidCashRefunded);
    if (refundedCents === null || refundedCents <= 0) invalid("Invalid partial cash refund.");
  }
  return { storeId: body.storeId, receiptId: body.receiptId, reason: reasonOf(body.reason), disposition, refundedCents };
}

export async function runReceiptVoid(db: Firestore, input: ReceiptVoidInput, operator: Operator, nowMs = Date.now()) {
  const { storeId, receiptId } = input;
  const ref = db.doc(`stores/${storeId}/receipts/${receiptId}`);
  return db.runTransaction(async (tx) => {
    const snap = (await tx.get(ref)) as any;
    if (!snap.exists) throw new PosCommandError("receipt_not_found", "Receipt not found.", 404);
    const r = snap.data();
    if (r.status === "voided") return { alreadyVoided: true, effectIds: [] as string[] };
    if (r.status !== "final") throw new PosCommandError("receipt_invalid", "Only final receipts can be voided.", 409);

    const cash: Record<string, unknown> = {};
    if (input.disposition) {
      const paidCents = Math.round(cashPaidOf(r) * 100);
      const refundedCents =
        input.disposition === "refunded" ? paidCents : input.disposition === "retained" ? 0 : (input.refundedCents as number);
      if (refundedCents < 0 || refundedCents > paidCents) {
        throw new PosCommandError("tender_invalid", "Cash refunded on void cannot exceed the cash paid on the receipt.", 409);
      }
      if (input.disposition === "partial" && refundedCents >= paidCents) {
        throw new PosCommandError("tender_invalid", "A partial cash refund must be less than the cash paid.", 409);
      }
      Object.assign(cash, {
        voidCashPaid: paidCents / 100,
        voidCashRefunded: refundedCents / 100,
        voidCashRetained: (paidCents - refundedCents) / 100,
        voidCashDisposition: input.disposition,
      });
    }
    tx.update(ref, {
      status: "voided",
      voidedAt: FieldValue.serverTimestamp(),
      voidedAtClientMs: nowMs,
      voidedByUid: operator.uid,
      voidedByUsername: operator.username,
      voidedByProfileId: operator.profileId,
      voidReason: input.reason,
      ...cash,
      analyticsReversed: false,
    });
    const source = { type: "receipt" as const, receiptId };
    const effectIds = queueEffectsInTx(db, tx, storeId, source, [
      { effect: "analytics", discriminator: "void", payload: { op: "void", receiptId } },
      ...(r.isRefund
        ? []
        : [{ effect: "loyaltyReverseReceipt" as const, discriminator: "void", payload: { receiptId, reason: "receipt_void", actorUid: operator.uid } }]),
    ], nowMs);
    return { alreadyVoided: false, effectIds };
  });
}

// ---------------------------------------------------------------- correction

export type ReceiptEditInput = {
  storeId: string;
  receiptId: string;
  expectedEditVersion: number;
  reason: string;
  lines: SessionBillLine[];
  billDiscount: any;
  customAdjustments: any[];
  customerName: string | null;
  customerTin: string | null;
  customerAddress: string | null;
  payments: Array<{ id?: string; methodId: string; amount: number }>;
};

const optText = (v: unknown, max = 300): string | null => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || v.length > max) invalid("Invalid text field.");
  return v as string;
};

export function parseReceiptEditInput(body: any): ReceiptEditInput {
  if (!body || !isSafeId(body.storeId) || !isSafeId(body.receiptId)) invalid("Missing storeId or receiptId.");
  if (!Number.isSafeInteger(body.expectedEditVersion) || body.expectedEditVersion < 0) invalid("Invalid expectedEditVersion.");
  if (!Array.isArray(body.lines) || body.lines.length > 500) invalid("Invalid lines.");
  for (const l of body.lines) {
    if (!l || typeof l !== "object" || !isSafeId(l.id, 200)) invalid("Invalid line.");
    for (const f of ["qtyOrdered", "unitPrice"]) {
      if (typeof l[f] !== "number" || !Number.isFinite(l[f]) || l[f] < 0) invalid(`Invalid line ${f}.`);
    }
  }
  if (!Array.isArray(body.payments) || body.payments.length > 20) invalid("Invalid payments.");
  const payments = body.payments.map((p: any) => {
    if (!p || !isSafeId(p.methodId)) invalid("Invalid tender method.");
    const cents = strictCentavos(p.amount);
    if (cents === null || cents < 0) throw new PosCommandError("tender_invalid", "Invalid tender amount.", 400);
    return { id: typeof p.id === "string" ? p.id.slice(0, 64) : undefined, methodId: p.methodId, amount: cents / 100 };
  });
  if (body.customAdjustments != null && !Array.isArray(body.customAdjustments)) invalid("Invalid adjustments.");
  return {
    storeId: body.storeId,
    receiptId: body.receiptId,
    expectedEditVersion: body.expectedEditVersion,
    reason: reasonOf(body.reason),
    lines: body.lines,
    billDiscount: body.billDiscount ?? null,
    customAdjustments: body.customAdjustments ?? [],
    customerName: optText(body.customerName),
    customerTin: optText(body.customerTin, 50),
    customerAddress: optText(body.customerAddress, 500),
    payments,
  };
}

function revisionStamp(nowMs: number): string {
  const d = new Date(nowMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/**
 * @param ensurePaymentApplied called (outside the edit transaction) when the
 *   receipt's own payment analytics is still pending, so the edit delta
 *   (old -> new) always has the original sale as its base.
 */
export async function runReceiptEdit(
  db: Firestore,
  input: ReceiptEditInput,
  operator: Operator,
  ensurePaymentApplied: (storeId: string, receiptId: string) => Promise<unknown>,
  nowMs = Date.now(),
) {
  const { storeId, receiptId } = input;
  const ref = db.doc(`stores/${storeId}/receipts/${receiptId}`);
  const pre = (await ref.get()) as any;
  if (pre.exists && pre.data()?.analyticsApplied === false && pre.data()?.status === "final") {
    await ensurePaymentApplied(storeId, receiptId);
  }

  return db.runTransaction(async (tx) => {
    const [snap, storeSnap, configSnap] = (await Promise.all([
      tx.get(ref),
      tx.get(db.doc(`stores/${storeId}`)),
      tx.get(db.doc(`stores/${storeId}/storeConfig/current`)),
    ])) as any[];
    if (!snap.exists) throw new PosCommandError("receipt_not_found", "Receipt not found.", 404);
    const r = { id: receiptId, ...snap.data() } as Receipt & Record<string, any>;
    if (r.status !== "final" || r.isRefund) throw new PosCommandError("receipt_invalid", "Only final sale receipts can be corrected.", 409);
    if (Number(r.editVersion || 0) !== input.expectedEditVersion) {
      throw new PosCommandError("receipt_changed", "This receipt was changed by someone else. Reopen it and try again.", 409);
    }
    const store = { id: storeId, ...(storeSnap.exists ? storeSnap.data() : {}) } as Store;
    const methods: ModeOfPayment[] = Array.isArray(configSnap.data()?.modesOfPayment) ? configSnap.data().modesOfPayment : [];
    for (const p of input.payments) {
      if (!methods.some((m) => m.id === p.methodId)) {
        throw new PosCommandError("tender_invalid", "A tender uses an unknown payment method.", 409);
      }
    }

    const totals = receiptCorrectionTotals(r, input.lines, store, input.billDiscount, input.customAdjustments);
    const grandCents = Math.round(totals.grandTotal * 100);
    const paidCents = input.payments.reduce((s, p) => s + Math.round(p.amount * 100), 0);
    if (paidCents < grandCents - 1) {
      throw new PosCommandError("tender_invalid", "Total paid cannot be less than the new grand total.", 409);
    }
    const { settled, refund } = settleTendersToTotal(input.payments, totals.grandTotal, methods);
    const settledCents = settled.reduce((s, p) => s + Math.round(p.amount * 100), 0);
    const mop: Record<string, number> = {};
    for (const p of settled) {
      const key = methods.find((m) => m.id === p.methodId)?.name || p.methodId || "unknown";
      mop[key] = (Math.round((mop[key] || 0) * 100) + Math.round(p.amount * 100)) / 100;
    }
    const sales = computeSalesAnalytics(input.lines, store);
    const version = Number(r.editVersion || 0) + 1;
    const revisionId = `v${version}_${revisionStamp(nowMs)}`;

    tx.set(db.doc(`stores/${storeId}/receipts/${receiptId}/revisions/${revisionId}`), {
      version,
      editedAt: FieldValue.serverTimestamp(),
      editedAtClientMs: nowMs,
      editedByUid: operator.uid,
      editedByUsername: operator.username,
      editedByProfileId: operator.profileId,
      reason: input.reason,
      snapshot: r,
    });
    const prevAnalytics = (r.analytics || {}) as any;
    tx.update(ref, dropUndefined({
      customerName: input.customerName,
      customerTin: input.customerTin,
      customerAddress: input.customerAddress,
      lines: input.lines,
      billDiscount: input.billDiscount ?? null,
      customAdjustments: input.customAdjustments ?? [],
      total: totals.grandTotal,
      totalPaid: settledCents / 100,
      change: 0,
      ...(refund > 0.005 ? { refundedTotal: roundMoney(Number(r.refundedTotal || 0) + refund) } : {}),
      analytics: dropUndefined({
        v: 2,
        sessionStartedAt: prevAnalytics.sessionStartedAt,
        sessionStartedAtClientMs: prevAnalytics.sessionStartedAtClientMs,
        sessionStartedAtHour: prevAnalytics.sessionStartedAtHour,
        guestCountSnapshot: prevAnalytics.guestCountSnapshot,
        servedRefillsByName: prevAnalytics.servedRefillsByName,
        serveCountByType: prevAnalytics.serveCountByType,
        serveTimeMsTotalByType: prevAnalytics.serveTimeMsTotalByType,
        subtotal: totals.subtotal,
        discountsTotal: totals.totalDiscounts,
        chargesTotal: totals.chargesTotal,
        taxAmount: totals.taxTotal,
        vatableSales: totals.vatableSales,
        vatExemptSales: totals.vatExemptSales,
        grandTotal: totals.grandTotal,
        totalPaid: settledCents / 100,
        change: 0,
        mop,
        salesByItem: sales.salesByItem,
        salesByCategory: sales.salesByCategory,
      }),
      isEdited: true,
      editVersion: version,
      editedAt: FieldValue.serverTimestamp(),
      editedByUid: operator.uid,
      editedByUsername: operator.username,
      editedByProfileId: operator.profileId,
      editReason: input.reason,
    }));
    const effectIds = queueEffectsInTx(db, tx, storeId, { type: "receipt", receiptId }, [
      { effect: "analytics", discriminator: `edit_v${version}`, payload: { op: "edit", receiptId, revisionId } },
    ], nowMs);
    return { revisionId, editVersion: version, total: totals.grandTotal, refund, effectIds };
  });
}

// ---------------------------------------------------------------- refund

export type RefundInput = {
  storeId: string;
  parentReceiptId: string;
  refundId: string;
  refundQtys: Record<string, number>;
  reason: string;
};

export function parseRefundInput(body: any): RefundInput {
  if (!body || !isSafeId(body.storeId) || !isSafeId(body.parentReceiptId) || !isSafeId(body.requestId, 64)) {
    invalid("Missing storeId, parentReceiptId or requestId.");
  }
  if (!body.refundQtys || typeof body.refundQtys !== "object" || Array.isArray(body.refundQtys)) invalid("Invalid refund quantities.");
  const refundQtys: Record<string, number> = {};
  for (const [k, v] of Object.entries(body.refundQtys)) {
    if (!isSafeId(k, 200) || typeof v !== "number" || !Number.isFinite(v) || v < 0) invalid("Invalid refund quantity.");
    refundQtys[k] = v as number;
  }
  return { storeId: body.storeId, parentReceiptId: body.parentReceiptId, refundId: body.requestId, refundQtys, reason: reasonOf(body.reason) };
}

/** Port of the pre-P1 createRefundReceipt transaction (same quoteRefund math). */
export async function runRefund(db: Firestore, input: RefundInput, operator: Operator, nowMs = Date.now()) {
  const { storeId, parentReceiptId, refundId } = input;
  const refundRef = db.doc(`stores/${storeId}/receipts/${refundId}`);
  const parentRef = db.doc(`stores/${storeId}/receipts/${parentReceiptId}`);
  return db.runTransaction(async (tx) => {
    const [existing, parentSnap] = (await Promise.all([tx.get(refundRef), tx.get(parentRef)])) as any[];
    if (existing.exists) {
      const ex = existing.data();
      if (ex?.isRefund === true && ex?.parentReceiptId === parentReceiptId) return { refundId, created: false, effectIds: [] as string[] };
      throw new PosCommandError("command_invalid", "Refund request id collides with another receipt.", 409);
    }
    if (!parentSnap.exists) throw new PosCommandError("receipt_not_found", "Original receipt not found.", 404);
    const parent = { id: parentReceiptId, ...parentSnap.data() } as Receipt & Record<string, any>;

    let quote;
    try {
      quote = quoteRefund(parent, input.refundQtys);
    } catch (e: any) {
      throw new PosCommandError("refund_invalid", e?.message || "Invalid refund.", 409);
    }
    const totalCents = quote.totalCents;
    if (totalCents <= 0) throw new PosCommandError("refund_invalid", "Nothing left to refund on this receipt.", 409);

    const byId = new Map((parent.lines || []).map((l) => [l.id, l]));
    const refundLines = quote.lines.map((q) => ({
      ...(byId.get(q.lineId) as SessionBillLine),
      qtyOrdered: q.qty,
      freeQty: 0,
      voidedQty: 0,
      refundPaidAmount: q.paidCents / 100,
      refundSalesAmount: q.salesCents / 100,
    })) as SessionBillLine[];
    const mop: Record<string, number> = {};
    for (const [name, cents] of Object.entries(quote.mopCents)) mop[name] = -cents / 100;
    const total = -totalCents / 100;
    const refundGross = refundLines.reduce((s, l) => s + lineItemAmounts(l).gross, 0);
    const pa = (parent.analytics || {}) as any;

    tx.set(refundRef, dropUndefined({
      id: refundId,
      receiptId: refundId,
      parentReceiptId,
      isRefund: true,
      storeId,
      sessionId: parent.sessionId,
      createdByUid: operator.uid,
      createdByUsername: operator.username,
      operatorProfileId: operator.profileId,
      operatorVerified: operator.verified,
      commandId: refundId,
      sessionMode: parent.sessionMode,
      tableId: parent.tableId ?? null,
      tableNumber: parent.tableNumber ?? null,
      customerName: parent.customerName ?? null,
      customerTin: parent.customerTin ?? null,
      customerAddress: parent.customerAddress ?? null,
      lines: refundLines,
      total,
      totalPaid: total,
      change: 0,
      status: "final",
      receiptSeq: 0,
      receiptNumber: `RF-${parent.receiptNumber}`,
      receiptNoFormatUsed: parent.receiptNoFormatUsed,
      createdAtClientMs: nowMs,
      editReason: input.reason,
      refundPayments: Object.entries(quote.mopCents).map(([name, cents]) => ({ methodName: name, amount: cents / 100 })),
      analytics: {
        v: 2,
        sessionStartedAt: pa.sessionStartedAt ?? null,
        sessionStartedAtClientMs: pa.sessionStartedAtClientMs ?? null,
        subtotal: -roundMoney(refundGross),
        discountsTotal: -quote.discountsCents / 100,
        chargesTotal: -quote.chargesCents / 100,
        taxAmount: -quote.taxCents / 100,
        grandTotal: total,
        totalPaid: total,
        change: 0,
        mop,
      },
      createdAt: FieldValue.serverTimestamp(),
      analyticsApplied: false,
    }));

    const refundedQtys: Record<string, number> = { ...(parent.refundedQtys || {}) };
    for (const q of quote.lines) refundedQtys[q.lineId] = normalizeQty((Number(refundedQtys[q.lineId]) || 0) + q.qty);
    const refundedMop: Record<string, number> = { ...(parent.refundedMop || {}) };
    for (const [name, cents] of Object.entries(quote.mopCents)) {
      refundedMop[name] = (Math.round((Number(refundedMop[name]) || 0) * 100) + cents) / 100;
    }
    tx.update(parentRef, {
      refundedQtys,
      refundedMop,
      totalRefunded: (Math.round((Number(parent.totalRefunded) || 0) * 100) + totalCents) / 100,
      refundCount: (Number(parent.refundCount) || 0) + 1,
    });
    const effectIds = queueEffectsInTx(db, tx, storeId, { type: "receipt", receiptId: refundId }, [
      { effect: "analytics", payload: { op: "refund", receiptId: refundId } },
      { effect: "loyaltyReverseReceipt", payload: { receiptId: parentReceiptId, reason: "refund", refundReceiptId: refundId, actorUid: operator.uid } },
    ], nowMs);
    return { refundId, created: true, effectIds, totalCents };
  });
}
