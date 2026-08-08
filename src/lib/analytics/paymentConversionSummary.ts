// Pure, SDK-agnostic aggregation for the Payment Convert modal's history view.
// A conversion is a net-zero reshuffle of the day's payment mix; these helpers
// summarize a set of conversions (over any date range) into a signed net per
// method and per-day groups for display. No firebase imports — unit-testable.

import type { PaymentConversion } from "@/lib/analytics/applyPaymentConversion";

export type ConversionNet = Record<string, number>;

/** True for a conversion that still affects the mix (not voided). */
function isActive(c: PaymentConversion): boolean {
  return c.status !== "voided";
}

/**
 * Signed net moved per payment method across the given conversions. The `from`
 * method is debited (negative), the `to` method credited (positive). Voided
 * conversions are excluded. Both endpoints always appear as keys (a fully
 * netted-out method reads 0), so the caller can decide whether to hide zeros.
 */
export function netByMethod(rows: PaymentConversion[]): ConversionNet {
  const net: ConversionNet = {};
  for (const c of rows) {
    if (!isActive(c)) continue;
    const amt = Number(c.amount) || 0;
    net[c.fromMethod] = (net[c.fromMethod] ?? 0) - amt;
    net[c.toMethod] = (net[c.toMethod] ?? 0) + amt;
  }
  return net;
}

/** Count of active (non-voided) conversions. */
export function activeConversionCount(rows: PaymentConversion[]): number {
  return rows.reduce((n, c) => n + (isActive(c) ? 1 : 0), 0);
}

export type ConversionDayGroup = {
  dayId: string;
  entries: PaymentConversion[];
  net: ConversionNet;
};

/**
 * Group conversions by Manila day (dayId), newest day first, with each group's
 * entries ordered newest-first (by createdAtClientMs) and its own net-by-method.
 * Single-day ranges collapse to one group.
 */
export function groupConversionsByDay(rows: PaymentConversion[]): ConversionDayGroup[] {
  const byDay = new Map<string, PaymentConversion[]>();
  for (const c of rows) {
    const list = byDay.get(c.dayId);
    if (list) list.push(c);
    else byDay.set(c.dayId, [c]);
  }
  return [...byDay.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)) // dayId desc (newest first)
    .map((dayId) => {
      const entries = [...byDay.get(dayId)!].sort(
        (a, b) => (Number(b.createdAtClientMs) || 0) - (Number(a.createdAtClientMs) || 0),
      );
      return { dayId, entries, net: netByMethod(entries) };
    });
}
