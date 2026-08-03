import type { ActivityLog, KitchenTicket, Receipt, SessionBillLine, SessionDoc } from "@/lib/types";

/** Manager review flag, one per session: `stores/{storeId}/sessionAuditFlags/{sessionId}`. */
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

/** A guest device that joined via QR or PIN. */
export type GuestParticipant = {
  id: string;
  slotNumber?: number;
  joinMethod?: "qr" | "manual" | string;
  joinedAtMs?: number;
  status?: "active" | "revoked" | string;
};

/**
 * Everything one expansion fetches. `session` is null for a receipt-only row
 * (see `DailySessionRow.sessionId`); every collection is [] rather than null
 * when absent, because a missing subcollection reads as empty, not as an error.
 */
export type SessionTrailSources = {
  sessionId: string | null;
  receiptId: string;
  session: SessionDoc | null;
  receipt: Receipt | null;
  billLines: SessionBillLine[];
  tickets: KitchenTicket[];
  activityLogs: ActivityLog[];
  flag: SessionAuditFlag | null;
  participants: GuestParticipant[];
};

/** Exception counters for one session. */
export type RiskCounts = {
  voids: number;
  discounts: number;
  freeItems: number;
  receiptEdits: number;
  kitchenCancels: number;
  guestChanges: number;
  packageChanges: number;
  priceOverrides: number;
};

export const EMPTY_RISK: RiskCounts = {
  voids: 0,
  discounts: 0,
  freeItems: 0,
  receiptEdits: 0,
  kitchenCancels: 0,
  guestChanges: 0,
  packageChanges: 0,
  priceOverrides: 0,
};

export function riskTotal(r: RiskCounts): number {
  return r.voids + r.discounts + r.freeItems + r.receiptEdits + r.kitchenCancels
    + r.guestChanges + r.packageChanges + r.priceOverrides;
}
