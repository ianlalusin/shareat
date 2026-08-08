import { describe, it, expect } from "vitest";
import { buildSessionRow, MAX_SESSION_DURATION_MS } from "@/lib/analytics/session-row";
import type { Receipt, SessionBillLine, Store } from "@/lib/types";

const store = {
  id: "s1",
  taxType: "VAT_INCLUSIVE",
  taxRatePct: 12,
} as unknown as Store;

/** Bill line with the real field names; defaults mirror a plain, undiscounted sale. */
function line(opts: Partial<SessionBillLine> & { unitPrice?: number; qtyOrdered?: number } = {}) {
  return {
    id: opts.id ?? "l1",
    type: opts.type ?? "addon",
    itemId: "i1",
    itemName: "Item",
    category: "Drinks",
    unitPrice: opts.unitPrice ?? 100,
    qtyOrdered: opts.qtyOrdered ?? 2,
    discountType: opts.discountType ?? null,
    discountValue: opts.discountValue ?? null,
    discountQty: opts.discountQty ?? 0,
    freeQty: opts.freeQty ?? 0,
    voidedQty: opts.voidedQty ?? 0,
    lineAdjustments: opts.lineAdjustments,
    createdAt: null,
    updatedAt: null,
  } as unknown as SessionBillLine;
}

const CLOSE_MS = Date.UTC(2026, 7, 1, 5, 0, 0); // 2026-08-01 13:00 PHT

function receipt(extra: Partial<Receipt> = {}): Receipt {
  return {
    id: "r1",
    storeId: "s1",
    sessionId: "sess1",
    receiptNumber: "OR-00001",
    sessionMode: "alacarte",
    tableNumber: null,
    customerName: "Walk-in",
    status: "final",
    createdAtClientMs: CLOSE_MS,
    createdAt: null,
    lines: [line()],
    total: 200,
    analytics: { v: 2, sessionStartedAtClientMs: CLOSE_MS - 90 * 60_000 },
    ...extra,
  } as unknown as Receipt;
}

describe("buildSessionRow", () => {
  it("keys the row by receipt id, so two receipts on one session both survive", () => {
    const a = buildSessionRow(receipt({ id: "rA" }), store);
    const b = buildSessionRow(receipt({ id: "rB" }), store);
    expect(a!.rowKey).toBe("rA");
    expect(b!.rowKey).toBe("rB");
    // Same session on both — keying by sessionId would have collapsed them.
    expect(a!.row.sessionId).toBe(b!.row.sessionId);
  });

  it("drops voided receipts entirely", () => {
    expect(buildSessionRow(receipt({ status: "voided" }), store)).toBeNull();
    expect(buildSessionRow(receipt({ isVoided: true } as any), store)).toBeNull();
  });

  it("drops a receipt with no usable close time", () => {
    expect(buildSessionRow(receipt({ createdAtClientMs: 0, createdAt: null }), store)).toBeNull();
  });

  describe("dine-in vs ala carte", () => {
    it("reports package name and pax for package dine-in", () => {
      const r = buildSessionRow(
        receipt({
          sessionMode: "package_dinein",
          tableNumber: "T4",
          analytics: {
            v: 2,
            sessionStartedAtClientMs: CLOSE_MS - 60_000,
            guestCountSnapshot: { finalGuestCount: 6, packageName: "Unli Samgyup" },
          },
        } as any),
        store
      )!;
      expect(r.row.sessionMode).toBe("package_dinein");
      expect(r.row.pax).toBe(6);
      expect(r.row.packageName).toBe("Unli Samgyup");
      expect(r.row.tableNumber).toBe("T4");
    });

    it("counts billable items for ala carte and leaves pax/package empty", () => {
      const r = buildSessionRow(
        receipt({ lines: [line({ qtyOrdered: 5, voidedQty: 1, freeQty: 1 }), line({ id: "l2", qtyOrdered: 2 })] }),
        store
      )!;
      // (5 - 1 - 1) + 2
      expect(r.row.itemCount).toBe(5);
      expect(r.row.pax).toBeNull();
      expect(r.row.packageName).toBeNull();
    });
  });

  describe("discount split", () => {
    it("separates bill-level discount from the combined total", () => {
      const r = buildSessionRow(
        receipt({
          lines: [
            line({
              lineAdjustments: {
                a1: { id: "a1", kind: "discount", type: "fixed", value: 30, qty: 1, note: "", createdAtClientMs: 1, createdByUid: "u" },
              } as any,
            }),
          ],
          // 10% off (200 gross - 30 line) = 17
          billDiscount: { id: "d1", name: "Promo", type: "percent", value: 10, scope: ["bill"] } as any,
          analytics: { v: 2, sessionStartedAtClientMs: CLOSE_MS - 60_000 },
        }),
        store
      )!;
      expect(r.row.billDiscount).toBeCloseTo(17, 2);
      // line 30 + bill 17
      expect(r.row.totalDiscount).toBeCloseTo(47, 2);
    });

    it("treats a legacy line discount the same as a lineAdjustments one", () => {
      const viaAdjustment = buildSessionRow(
        receipt({
          lines: [
            line({
              lineAdjustments: {
                a1: { id: "a1", kind: "discount", type: "fixed", value: 30, qty: 1, note: "", createdAtClientMs: 1, createdByUid: "u" },
              } as any,
            }),
          ],
          analytics: { v: 2 },
        }),
        store
      )!;
      const viaLegacy = buildSessionRow(
        receipt({
          lines: [line({ discountType: "fixed", discountValue: 30, discountQty: 1 })],
          analytics: { v: 2 },
        }),
        store
      )!;
      expect(viaLegacy.row.totalDiscount).toBeCloseTo(viaAdjustment.row.totalDiscount, 2);
      expect(viaLegacy.row.totalDiscount).toBeCloseTo(30, 2);
    });

    it("counts a redeemed loyalty reward as a bill-level discount", () => {
      const r = buildSessionRow(
        receipt({
          loyaltyRedemptions: [{ type: "fixed", value: 50 }] as any,
          analytics: { v: 2 },
        }),
        store
      )!;
      expect(r.row.billDiscount).toBeCloseTo(50, 2);
      expect(r.row.totalDiscount).toBeCloseTo(50, 2);
    });

    it("prefers the receipt's persisted discountsTotal over a recomputation", () => {
      const r = buildSessionRow(
        receipt({
          lines: [line({ discountType: "fixed", discountValue: 30, discountQty: 1 })],
          analytics: { v: 2, discountsTotal: 41.25, chargesTotal: 7.5 },
        }),
        store
      )!;
      expect(r.row.totalDiscount).toBe(41.25);
      expect(r.row.chargesTotal).toBe(7.5);
    });
  });

  describe("dwell time", () => {
    it("measures close minus start", () => {
      const r = buildSessionRow(receipt(), store)!;
      expect(r.row.durationMs).toBe(90 * 60_000);
      expect(r.row.startedAtMs).toBe(CLOSE_MS - 90 * 60_000);
      expect(r.row.closedAtMs).toBe(CLOSE_MS);
    });

    it("is null when the session start was never recorded", () => {
      const r = buildSessionRow(receipt({ analytics: { v: 2 } }), store)!;
      expect(r.row.startedAtMs).toBeNull();
      expect(r.row.durationMs).toBeNull();
    });

    it("rejects a clock-skewed duration beyond the 24h bound", () => {
      const r = buildSessionRow(
        receipt({ analytics: { v: 2, sessionStartedAtClientMs: CLOSE_MS - (MAX_SESSION_DURATION_MS + 60_000) } }),
        store
      )!;
      expect(r.row.durationMs).toBeNull();
    });
  });

  describe("day bucketing", () => {
    it("buckets on the Manila calendar day, not UTC", () => {
      // 15:30Z = 23:30 PHT on Aug 1
      const lateAug1 = buildSessionRow(receipt({ createdAtClientMs: Date.UTC(2026, 7, 1, 15, 30) }), store)!;
      expect(lateAug1.dayId).toBe("20260801");

      // 16:30Z = 00:30 PHT on Aug 2 — same UTC day, next Manila day
      const earlyAug2 = buildSessionRow(receipt({ createdAtClientMs: Date.UTC(2026, 7, 1, 16, 30) }), store)!;
      expect(earlyAug2.dayId).toBe("20260802");
    });
  });

  it("flags a refund receipt so the page can render it apart", () => {
    const r = buildSessionRow(receipt({ isRefund: true, total: -200 } as any), store)!;
    expect(r.row.isRefund).toBe(true);
    expect(r.row.total).toBe(-200);
  });
});
