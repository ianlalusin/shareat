import { describe, it, expect, beforeEach, vi } from "vitest";

// Refunds are a server command since audit P1 (createRefundReceipt posts to
// /api/pos/commands/refund). These are the B11/B12/B13 refund regressions,
// now driven against the real server transaction (runRefund) on the in-memory
// Admin-SDK FakeFirestore, which re-runs conflicting transactions like
// Firestore does.
vi.mock("firebase-admin/firestore", async () => (await import("@/lib/server/analytics/testing/fakeFirestore")).firestoreModule);

import { FakeFirestore } from "@/lib/server/analytics/testing/fakeFirestore";
import { runRefund } from "@/lib/server/pos-commands/receipt-commands";
import type { Operator } from "@/lib/server/pos-commands/operator";
import { getPaymentContribution, getSalesContribution } from "@/lib/analytics/daily";

const ORIG = "stores/a/receipts/original";
const actor: Operator = { uid: "staff", username: "Staff", profileId: null, verified: false };
const line = { id: "line", type: "addon", itemId: "inv1", itemName: "Mock", category: "Food", qtyOrdered: 1, freeQty: 0, voidedQty: 0, unitPrice: 100 };
const parent = {
  id: "original", receiptId: "original", storeId: "a", sessionId: "s", status: "final", sessionMode: "alacarte",
  total: 80, receiptNumber: "001", createdAtClientMs: 1793224800000, lines: [line],
  analytics: { v: 2, grandTotal: 80, discountsTotal: 20, chargesTotal: 0, taxAmount: 0, mop: { Cash: 80 } },
} as any;

let db: FakeFirestore;
const refund = (qtys: Record<string, number>, id: string) =>
  runRefund(db as any, { storeId: "a", parentReceiptId: "original", refundId: id, refundQtys: qtys, reason: "x" }, actor);
const refunds = () => Object.entries(db.snapshot()).filter(([p]) => p.startsWith("stores/a/receipts/rf-")).map(([, v]) => v as any);

beforeEach(() => {
  db = new FakeFirestore();
  db.seed(ORIG, structuredClone(parent));
});

describe("refund command (B11/B12/B13)", () => {
  it("discounted 80 sale refunds exactly 80, with a negative cash tender snapshot", async () => {
    await refund({ line: 1 }, "rf-1");
    const [rf] = refunds();
    expect(rf.total).toBe(-80);
    expect(rf.totalPaid).toBe(-80);
    expect(rf.analytics.mop).toEqual({ Cash: -80 });
    expect(rf.analytics.discountsTotal).toBe(-20);
    expect(db.data(ORIG).totalRefunded).toBe(80);
    expect(db.data(ORIG).refundedMop).toEqual({ Cash: 80 });
    expect(getPaymentContribution(parent).byMethod.Cash + getPaymentContribution(rf).byMethod.Cash).toBe(0);
    const s = getSalesContribution(parent).addonSalesByItem.Mock;
    const r = getSalesContribution(rf).addonSalesByItem.Mock;
    expect(s.qty + r.qty).toBe(0);
    expect(s.amount + r.amount).toBe(0);
  });

  it("two concurrent refunds of the one sold unit: exactly one succeeds", async () => {
    const results = await Promise.allSettled([refund({ line: 1 }, "rf-a"), refund({ line: 1 }, "rf-b")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(refunds()).toHaveLength(1);
    expect(db.data(ORIG).totalRefunded).toBe(80);
    expect(db.data(ORIG).refundedQtys).toEqual({ line: 1 });
  });

  it("retrying the same request id creates no second refund or increment", async () => {
    const a = await refund({ line: 1 }, "rf-same");
    const b = await refund({ line: 1 }, "rf-same");
    expect(a.refundId).toBe(b.refundId);
    expect(b.created).toBe(false);
    expect(refunds()).toHaveLength(1);
    expect(db.data(ORIG).refundCount).toBe(1);
  });

  it("refuses a voided original", async () => {
    db.seed(ORIG, { ...structuredClone(parent), status: "voided" });
    await expect(refund({ line: 1 }, "rf-v")).rejects.toThrow(/voided/);
    expect(refunds()).toHaveLength(0);
  });

  it("fractional quantities (e29b7e71): two half refunds cover the unit exactly", async () => {
    await refund({ line: 0.5 }, "rf-h1");
    await refund({ line: 0.5 }, "rf-h2");
    expect(db.data(ORIG).refundedQtys).toEqual({ line: 1 });
    expect(db.data(ORIG).totalRefunded).toBe(80);
    await expect(refund({ line: 0.001 }, "rf-h3")).rejects.toThrow();
  });
});
