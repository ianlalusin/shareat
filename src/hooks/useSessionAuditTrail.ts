"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { ActivityLog, KitchenTicket, Receipt, SessionBillLine } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";

export type SessionAuditFlag = {
  sessionId: string;
  storeId: string;
  status: "flagged" | "cleared";
  severity: "low" | "medium" | "high";
  reason?: string | null;
  notes?: string | null;
  flaggedByUid?: string | null;
  flaggedByName?: string | null;
  flaggedAt?: any;
  clearedByUid?: string | null;
  clearedByName?: string | null;
  clearedAt?: any;
  updatedAt?: any;
};

export type SessionAuditEvent = {
  id: string;
  timestamp: Date;
  type:
    | "session"
    | "billing"
    | "payment"
    | "void"
    | "discount"
    | "free"
    | "kitchen"
    | "change"
    | "flag"
    | "other";
  title: string;
  detail?: string;
  actorUid?: string | null;
  actorName?: string | null;
  amount?: number | null;
  source: "session" | "line" | "ticket" | "activity" | "receipt" | "flag";
  log?: ActivityLog;
};

export type SessionAuditRiskSummary = {
  voids: number;
  discounts: number;
  freeItems: number;
  receiptEdits: number;
  kitchenCancels: number;
  guestChanges: number;
  packageChanges: number;
  priceOverrides: number;
};

export type SessionAuditTrail = {
  session: any | null;
  receipt: Receipt | null;
  billLines: SessionBillLine[];
  tickets: KitchenTicket[];
  activityLogs: ActivityLog[];
  flag: SessionAuditFlag | null;
  events: SessionAuditEvent[];
  riskSummary: SessionAuditRiskSummary;
  participants: any[];
};

function eventTime(...values: any[]): Date | null {
  for (const value of values) {
    const date = toJsDate(value);
    if (date) return date;
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  }
  return null;
}

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `PHP ${n.toFixed(2)}`;
}

function describeLog(log: ActivityLog): SessionAuditEvent | null {
  const meta = (log.meta ?? {}) as any;
  const ts = eventTime(log.createdAt);
  if (!ts) return null;

  const qty = meta.qty ?? (log as any).qty;
  const qtyText = typeof qty === "number" && qty > 0 ? `${qty}x ` : "";
  const itemName = meta.itemName ? String(meta.itemName) : "";
  const reason = log.reason ?? meta.reason ?? log.note ?? undefined;
  let type: SessionAuditEvent["type"] = "other";
  let title = log.action.replace(/_/g, " ");
  let detail = reason;
  let amount: number | null = typeof meta.amount === "number" ? meta.amount : null;

  switch (log.action) {
    case "SESSION_STARTED":
      type = "session";
      title = "Session started";
      detail = [itemName, typeof meta.cashierGuestCount === "number" ? `${meta.cashierGuestCount} cashier guests` : null]
        .filter(Boolean)
        .join(" · ") || undefined;
      break;
    case "SESSION_VERIFIED":
      type = "session";
      title = `Session verified${meta.finalCount != null ? ` at ${meta.finalCount} guests` : ""}`;
      detail = meta.verifyDurationMs != null ? `Verification took ${Math.round(Number(meta.verifyDurationMs) / 1000)}s` : undefined;
      break;
    case "PAYMENT_COMPLETED":
      type = "payment";
      title = "Payment completed";
      detail = [meta.receiptNumber ? `Receipt ${meta.receiptNumber}` : null, money(meta.paymentTotal)].filter(Boolean).join(" · ") || undefined;
      amount = typeof meta.paymentTotal === "number" ? meta.paymentTotal : amount;
      break;
    case "VOID_TICKETS":
      type = "void";
      title = `Voided ${qtyText}${itemName || "item"}`;
      break;
    case "SESSION_VOIDED":
      type = "void";
      title = "Session voided";
      break;
    case "RECEIPT_VOIDED":
      type = "void";
      title = meta.receiptNumber ? `Receipt ${meta.receiptNumber} voided` : "Receipt voided";
      amount = Number(meta.total ?? meta.snapshot?.total ?? meta.snapshot?.analytics?.grandTotal ?? 0) || null;
      break;
    case "MARK_FREE":
      type = "free";
      title = `Marked ${qtyText}${itemName || "item"} free`;
      break;
    case "UNMARK_FREE":
      type = "free";
      title = `Removed free mark from ${qtyText}${itemName || "item"}`;
      break;
    case "DISCOUNT_APPLIED":
    case "BILL_DISCOUNT_APPLIED":
      type = "discount";
      title = itemName ? `Discount applied to ${itemName}` : "Bill discount applied";
      detail = meta.discountName ?? reason;
      break;
    case "DISCOUNT_EDITED":
      type = "discount";
      title = itemName ? `Discount edited on ${itemName}` : "Discount edited";
      detail = [meta.discountName, typeof meta.delta === "number" ? `Delta ${money(meta.delta)}` : null, reason].filter(Boolean).join(" · ") || undefined;
      amount = typeof meta.delta === "number" ? meta.delta : amount;
      break;
    case "DISCOUNT_REMOVED":
    case "BILL_DISCOUNT_REMOVED":
      type = "discount";
      title = itemName ? `Discount removed from ${itemName}` : "Bill discount removed";
      detail = meta.discountName ?? reason;
      break;
    case "CUSTOM_CHARGE_ADDED":
    case "CUSTOM_CHARGE_REMOVED":
    case "PRICE_OVERRIDE":
    case "edit_line":
    case "PACKAGE_QTY_OVERRIDE_SET":
    case "PACKAGE_QTY_RESYNC_APPROVED_CHANGE":
      type = "billing";
      title = log.action.replace(/_/g, " ");
      detail = reason ?? meta.diffSummary;
      break;
    case "ADDON_ADDED":
    case "REFILL_ADDED":
    case "TICKET_SERVED":
    case "TICKET_BATCH_SERVED":
      type = "kitchen";
      title = `${qtyText}${itemName || log.action.replace(/_/g, " ").toLowerCase()}`;
      detail = log.action.replace(/_/g, " ");
      break;
    case "TICKET_CANCELLED":
    case "TICKET_REMAINING_CANCELLED":
      type = "void";
      title = itemName ? `${itemName} cancelled in kitchen` : "Kitchen ticket cancelled";
      break;
    case "GUEST_COUNT_REQUESTED":
    case "GUEST_COUNT_APPROVED":
    case "GUEST_COUNT_REJECTED":
      type = "change";
      title = log.action.replace(/_/g, " ");
      detail = [meta.beforeQty != null ? `Before ${meta.beforeQty}` : null, meta.afterQty != null ? `After ${meta.afterQty}` : null, meta.newQty != null ? `Requested ${meta.newQty}` : null].filter(Boolean).join(" · ") || reason;
      break;
    case "PACKAGE_CHANGE_REQUESTED":
    case "PACKAGE_CHANGE_APPROVED":
    case "PACKAGE_CHANGE_REJECTED":
      type = "change";
      title = log.action.replace(/_/g, " ");
      detail = itemName || reason;
      break;
    case "RECEIPT_EDITED":
      type = "billing";
      title = "Receipt edited after close";
      detail = meta.diffSummary ?? reason;
      break;
    case "SESSION_AUDIT_FLAGGED":
      type = "flag";
      title = "Session flagged for review";
      detail = reason;
      break;
    case "SESSION_AUDIT_CLEARED":
      type = "flag";
      title = "Session audit flag cleared";
      detail = reason;
      break;
  }

  return {
    id: log.id,
    timestamp: ts,
    type,
    title,
    detail,
    actorUid: log.actorUid,
    actorName: log.actorName ?? log.serverProfileName ?? null,
    amount,
    source: "activity",
    log,
  };
}

function buildTicketEvents(tickets: KitchenTicket[]): SessionAuditEvent[] {
  const events: SessionAuditEvent[] = [];
  for (const ticket of tickets) {
    const itemName = (ticket as any).itemName ?? "Kitchen item";
    const qty = (ticket as any).qtyOrdered ?? (ticket as any).qty ?? 1;
    const qtyText = qty > 1 ? ` (${qty}x)` : "";

    const createdAt = eventTime((ticket as any).createdAt, (ticket as any).createdAtClientMs);
    if (createdAt) {
      events.push({
        id: `${ticket.id}-ticket-created`,
        timestamp: createdAt,
        type: "kitchen",
        title: `Ticket created: ${itemName}${qtyText}`,
        actorUid: (ticket as any).createdByUid ?? null,
        source: "ticket",
      });
    }

    const servedAt = eventTime((ticket as any).servedAt, (ticket as any).servedAtClientMs);
    if (servedAt) {
      events.push({
        id: `${ticket.id}-ticket-served`,
        timestamp: servedAt,
        type: "kitchen",
        title: `Ticket served: ${itemName}${qtyText}`,
        actorUid: (ticket as any).servedByUid ?? null,
        source: "ticket",
      });
    }

    const cancelledAt = eventTime((ticket as any).cancelledAt, (ticket as any).cancelledAtClientMs);
    if (cancelledAt) {
      events.push({
        id: `${ticket.id}-ticket-cancelled`,
        timestamp: cancelledAt,
        type: "void",
        title: `Ticket cancelled: ${itemName}${qtyText}`,
        detail: (ticket as any).cancelReason,
        actorUid: (ticket as any).cancelledByUid ?? null,
        source: "ticket",
      });
    }
  }
  return events;
}

function buildSessionEvents(session: any | null, receipt: Receipt | null, sessionId: string): SessionAuditEvent[] {
  if (!session) return [];
  const events: SessionAuditEvent[] = [];
  const startedAt = eventTime(session.startedAt, session.startedAtClientMs);
  if (startedAt) {
    events.push({
      id: `${sessionId}-session-started`,
      timestamp: startedAt,
      type: "session",
      title: "Session started",
      detail: [
        session.sessionMode === "alacarte" ? "Ala carte" : "Package dine-in",
        session.packageSnapshot?.name,
        session.guestCountCashierInitial != null ? `${session.guestCountCashierInitial} cashier guests` : null,
      ].filter(Boolean).join(" · ") || undefined,
      actorUid: session.startedByUid ?? null,
      source: "session",
    });
  }

  const verifiedAt = eventTime(session.verifiedAt);
  if (verifiedAt) {
    events.push({
      id: `${sessionId}-session-verified`,
      timestamp: verifiedAt,
      type: "session",
      title: "Session verified",
      detail: session.guestCountFinal != null ? `${session.guestCountFinal} final guests` : undefined,
      actorUid: session.verifiedByUid ?? null,
      actorName: session.verifiedByServerProfileName ?? null,
      source: "session",
    });
  }

  const closedAt = eventTime(session.closedAt, session.closedAtClientMs, receipt?.createdAt, receipt?.createdAtClientMs);
  if (closedAt) {
    events.push({
      id: `${sessionId}-session-closed`,
      timestamp: closedAt,
      type: "payment",
      title: "Session closed",
      detail: [receipt?.receiptNumber ? `Receipt ${receipt.receiptNumber}` : null, money(receipt?.total ?? session.receiptSnapshot?.grandTotal)].filter(Boolean).join(" · ") || undefined,
      actorUid: session.closedByUid ?? receipt?.createdByUid ?? null,
      actorName: receipt?.createdByUsername ?? null,
      amount: receipt?.total ?? null,
      source: "receipt",
    });
  }

  return events;
}

function buildRiskSummary(logs: ActivityLog[], tickets: KitchenTicket[], receipt: Receipt | null): SessionAuditRiskSummary {
  return {
    voids: logs.filter((l) => ["VOID_TICKETS", "SESSION_VOIDED", "RECEIPT_VOIDED"].includes(l.action)).length,
    discounts: logs.filter((l) => ["DISCOUNT_APPLIED", "DISCOUNT_EDITED", "DISCOUNT_REMOVED", "BILL_DISCOUNT_APPLIED", "BILL_DISCOUNT_REMOVED"].includes(l.action)).length,
    freeItems: logs.filter((l) => ["MARK_FREE", "UNMARK_FREE"].includes(l.action)).length,
    receiptEdits: logs.filter((l) => l.action === "RECEIPT_EDITED").length + (receipt?.isEdited ? 1 : 0),
    kitchenCancels: tickets.filter((t) => (t as any).status === "cancelled" || (t as any).cancelledAt).length,
    guestChanges: logs.filter((l) => l.action.startsWith("GUEST_COUNT_")).length,
    packageChanges: logs.filter((l) => l.action.startsWith("PACKAGE_CHANGE_")).length,
    priceOverrides: logs.filter((l) => l.action === "PRICE_OVERRIDE" || l.action === "edit_line").length,
  };
}

export function useSessionAuditTrail(storeId?: string, sessionId?: string) {
  const [data, setData] = useState<SessionAuditTrail>({
    session: null,
    receipt: null,
    billLines: [],
    tickets: [],
    activityLogs: [],
    flag: null,
    events: [],
    riskSummary: {
      voids: 0,
      discounts: 0,
      freeItems: 0,
      receiptEdits: 0,
      kitchenCancels: 0,
      guestChanges: 0,
      packageChanges: 0,
      priceOverrides: 0,
    },
    participants: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!storeId || !sessionId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const sessionRef = doc(db, "stores", storeId, "sessions", sessionId);

    const unsub = onSnapshot(
      sessionRef,
      async (sessionSnap) => {
        try {
          const session = sessionSnap.exists() ? { id: sessionSnap.id, ...sessionSnap.data() } : null;
          const linesRef = collection(db, "stores", storeId, "sessions", sessionId, "sessionBillLines");
          const ticketsRef = collection(db, "stores", storeId, "sessions", sessionId, "kitchentickets");
          const logsRef = collection(db, "stores", storeId, "sessions", sessionId, "activityLogs");
          const receiptRef = doc(db, "stores", storeId, "receipts", sessionId);
          const flagRef = doc(db, "stores", storeId, "sessionAuditFlags", sessionId);

          const [linesSnap, ticketsSnap, logsSnap, receiptSnap, flagSnap] = await Promise.all([
            getDocs(query(linesRef, orderBy("createdAt", "asc"))),
            getDocs(ticketsRef),
            getDocs(query(logsRef, orderBy("createdAt", "desc"), limit(500))),
            getDoc(receiptRef),
            getDoc(flagRef),
          ]);

          if (cancelled) return;

          const billLines = linesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SessionBillLine));
          const tickets = ticketsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as KitchenTicket));
          const activityLogs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ActivityLog));
          const receipt = receiptSnap.exists() ? ({ id: receiptSnap.id, ...receiptSnap.data() } as Receipt) : null;
          const flag = flagSnap.exists() ? (flagSnap.data() as SessionAuditFlag) : null;

          const events = [
            ...buildSessionEvents(session, receipt, sessionId),
            ...buildTicketEvents(tickets),
            ...activityLogs.map(describeLog).filter(Boolean),
          ] as SessionAuditEvent[];

          events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

          setData((prev) => ({
            session,
            receipt,
            billLines,
            tickets,
            activityLogs,
            flag,
            events,
            riskSummary: buildRiskSummary(activityLogs, tickets, receipt),
            participants: prev.participants,
          }));
          setLoading(false);
        } catch (err: any) {
          if (cancelled) return;
          setError(err);
          setLoading(false);
        }
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    const participantsRef = collection(db, "stores", storeId, "activeSessions", sessionId, "customerParticipants");
    const unsubParticipants = onSnapshot(
      query(participantsRef, orderBy("joinedAtMs", "desc")),
      (snap) => {
        if (cancelled) return;
        setData((prev) => ({
          ...prev,
          participants: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
        }));
      }
    );

    return () => {
      cancelled = true;
      unsub();
      unsubParticipants();
    };
  }, [storeId, sessionId]);

  const focusedEventIds = useMemo(() => new Set(data.events.map((e) => e.id)), [data.events]);

  return { ...data, loading, error, focusedEventIds };
}
