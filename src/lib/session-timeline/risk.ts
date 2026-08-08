import type { ActivityLog, KitchenTicket, Receipt } from "@/lib/types";
import { EMPTY_RISK, type RiskCounts } from "./types";

const VOID_ACTIONS = ["VOID_TICKETS", "SESSION_VOIDED", "RECEIPT_VOIDED", "RECEIPT_REFUND"];
const DISCOUNT_ACTIONS = [
  "DISCOUNT_APPLIED", "DISCOUNT_EDITED", "DISCOUNT_REMOVED",
  "BILL_DISCOUNT_APPLIED", "BILL_DISCOUNT_REMOVED",
];
const FREE_ACTIONS = ["MARK_FREE", "UNMARK_FREE"];
const OVERRIDE_ACTIONS = ["PRICE_OVERRIDE", "edit_line"];

/** Exception counters for one session's logs. */
export function buildRiskSummary(
  logs: ActivityLog[],
  tickets: KitchenTicket[] = [],
  receipt: Receipt | null = null
): RiskCounts {
  return {
    voids: logs.filter((l) => VOID_ACTIONS.includes(l.action)).length,
    discounts: logs.filter((l) => DISCOUNT_ACTIONS.includes(l.action)).length,
    freeItems: logs.filter((l) => FREE_ACTIONS.includes(l.action)).length,
    receiptEdits: logs.filter((l) => l.action === "RECEIPT_EDITED").length + (receipt?.isEdited ? 1 : 0),
    kitchenCancels: tickets.filter((t) => (t as any).status === "cancelled" || (t as any).cancelledAt).length,
    guestChanges: logs.filter((l) => l.action.startsWith("GUEST_COUNT_")).length,
    packageChanges: logs.filter((l) => l.action.startsWith("PACKAGE_CHANGE_")).length,
    priceOverrides: logs.filter((l) => OVERRIDE_ACTIONS.includes(l.action)).length,
  };
}

/**
 * Counters per session, from a day's worth of logs.
 *
 * Lets the collapsed session rows show exception chips at **zero extra read
 * cost** — the Day Review panel has already loaded the day's activity logs, so
 * this just regroups what is in memory. Ticket and receipt signals are absent
 * here (they live in per-session subcollections); those only appear once a row
 * is expanded.
 */
export function buildRiskBySession(logs: ActivityLog[]): Map<string, RiskCounts> {
  const bySession = new Map<string, ActivityLog[]>();
  for (const log of logs) {
    if (!log.sessionId) continue;
    const bucket = bySession.get(log.sessionId);
    if (bucket) bucket.push(log);
    else bySession.set(log.sessionId, [log]);
  }

  const out = new Map<string, RiskCounts>();
  for (const [sessionId, sessionLogs] of bySession) {
    const counts = buildRiskSummary(sessionLogs);
    if (counts !== EMPTY_RISK) out.set(sessionId, counts);
  }
  return out;
}
