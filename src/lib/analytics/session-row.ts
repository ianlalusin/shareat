// Universal module: pure row math for the Daily Session Timeline. No Firestore
// imports, so the admin-SDK writer, the backfill and the client page all share
// one definition of a row (same split as delta-core / daily.ts).

import type { Receipt, Store } from "@/lib/types";
import { calculateBillTotals } from "@/lib/tax";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { toJsDate } from "@/lib/utils/date";

/**
 * Reject absurd dwell times (clock skew / a session left open overnight) so one
 * bad row cannot make the day's average meaningless. Same bound and reasoning as
 * getClosedSessionsContribution in daily.ts.
 */
export const MAX_SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

export type DailySessionRow = {
  sessionId: string | null;
  receiptId: string;
  receiptNumber: string | null;
  sessionMode: "package_dinein" | "alacarte";
  tableNumber: string | null;
  customerName: string | null;
  /**
   * Headcount. Only package dine-in persists a guest-count snapshot on the
   * receipt, so this is null for ala carte — the figure lives on the session
   * doc, which neither the payment path nor the backfill reads.
   */
  pax: number | null;
  packageName: string | null;
  /** Billable item quantity (qtyOrdered - voided - free), the ala carte headline. */
  itemCount: number;
  /** Bill-level discount: whole-bill discount + any loyalty reward redeemed. */
  billDiscount: number;
  chargesTotal: number;
  /** Every discount on the bill: line-level + bill-level + loyalty. */
  totalDiscount: number;
  total: number;
  startedAtMs: number | null;
  closedAtMs: number;
  durationMs: number | null;
  isRefund?: true;
};

export type BuiltSessionRow = { dayId: string; rowKey: string; row: DailySessionRow };

function isVoidReceipt(r: any): boolean {
  return !r || r.status === "voided" || r.isVoided === true;
}

/**
 * Builds the timeline row for one receipt, or null when the receipt does not
 * belong on the timeline (voided, or missing a usable close time).
 *
 * Rows are keyed by RECEIPT id, not session id: a void-and-re-ring and a refund
 * both produce a second receipt against the same session, and keying by session
 * would silently drop one of them. Keying by receipt also makes the row count
 * equal analytics/{dayId}.payments.txCount exactly, which is what the
 * reconciliation check in the admin backfill tool relies on.
 *
 * `store` is required for the discount split — calculateBillTotals needs the tax
 * mode to know whether a line discount applies to the VAT-inclusive or the
 * VAT-exclusive unit price.
 */
export function buildSessionRow(receipt: Receipt | null, store: Store | null): BuiltSessionRow | null {
  if (!receipt) return null;
  // Closed/paid sessions only. A void is removed from the day doc by the caller.
  if (isVoidReceipt(receipt)) return null;

  const closedAtMs = receipt.createdAtClientMs || toJsDate(receipt.createdAt)?.getTime() || null;
  if (!closedAtMs) return null;

  const analytics = (receipt.analytics || {}) as any;

  const startedAtMs =
    analytics.sessionStartedAtClientMs ?? toJsDate(analytics.sessionStartedAt)?.getTime() ?? null;

  let durationMs: number | null = null;
  if (startedAtMs && closedAtMs > startedAtMs) {
    const d = closedAtMs - startedAtMs;
    if (d > 0 && d <= MAX_SESSION_DURATION_MS) durationMs = d;
  }

  // Matches billableQty in getSalesContribution, so the item count agrees with
  // what the sales rollups actually billed.
  let itemCount = 0;
  for (const line of receipt.lines || []) {
    const qty = (line.qtyOrdered || 0) - (line.voidedQty || 0) - (line.freeQty || 0);
    if (qty > 0) itemCount += qty;
  }

  // Re-run the cashier's own totals function over the receipt's persisted
  // billing inputs. The receipt stores discountsTotal but NOT the bill-vs-line
  // split, and re-deriving that split by subtraction would disagree with the
  // cashier on VAT-inclusive stores (line discounts there apply to the
  // VAT-stripped unit price).
  const loyalty = (receipt.loyaltyRedemptions || []).map((r) => ({ type: r.type, value: r.value }));
  const totals = calculateBillTotals(
    receipt.lines || [],
    store,
    receipt.billDiscount ?? null,
    receipt.customAdjustments ?? [],
    loyalty
  );

  // The persisted analytics figures are canonical for the totals they carry
  // (they are what every other rollup and the printed sales report already use);
  // calculateBillTotals only supplies the split the receipt never persisted.
  const totalDiscount = Number(analytics.discountsTotal ?? totals.totalDiscounts ?? 0);
  const chargesTotal = Number(analytics.chargesTotal ?? totals.chargesTotal ?? 0);
  const billDiscount = Number(totals.billDiscountTotal || 0) + Number(totals.loyaltyDiscountTotal || 0);

  const isDineIn = receipt.sessionMode === "package_dinein";

  return {
    dayId: getDayIdFromTimestamp(closedAtMs),
    rowKey: receipt.id,
    row: {
      sessionId: receipt.sessionId ?? null,
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber ?? null,
      sessionMode: isDineIn ? "package_dinein" : "alacarte",
      tableNumber: receipt.tableNumber ?? null,
      customerName: receipt.customerName ?? null,
      pax: isDineIn ? Number(analytics.guestCountSnapshot?.finalGuestCount ?? 0) : null,
      packageName: isDineIn ? (analytics.guestCountSnapshot?.packageName ?? null) : null,
      itemCount,
      billDiscount,
      chargesTotal,
      totalDiscount,
      total: Number(receipt.total ?? analytics.grandTotal ?? 0),
      startedAtMs,
      closedAtMs,
      durationMs,
      ...(receipt.isRefund ? { isRefund: true as const } : {}),
    },
  };
}

/** Day-doc shape at stores/{storeId}/dailySessions/{YYYYMMDD}. */
export type DailySessionsDoc = {
  meta: {
    storeId: string;
    dayId: string;
    dayStartMs?: number;
    updatedAt?: any;
    rebuiltAt?: any;
    source?: string;
  };
  rows?: Record<string, DailySessionRow>;
};

/** Sort helper shared by the page and the reconciliation check. */
export function sortRows(rows: DailySessionRow[]): DailySessionRow[] {
  return [...rows].sort(
    (a, b) => (a.startedAtMs ?? a.closedAtMs) - (b.startedAtMs ?? b.closedAtMs)
  );
}
