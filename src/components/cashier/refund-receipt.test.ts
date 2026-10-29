import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory stand-in for the client Firestore SDK. Transactions are
// serialized, matching Firestore's guarantee that two transactions touching
// the same doc cannot both commit on stale reads.
const state = new Map<string, any>();
let txChain: Promise<unknown> = Promise.resolve();

const snap = (path: string) => ({
  id: path.split("/").pop(),
  exists: () => state.has(path),
  data: () => state.get(path),
});

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/"), id: parts[parts.length - 1] }),
  serverTimestamp: () => ({ __ts: true }),
  increment: (n: number) => ({ __inc: n }),
  getDoc: async (ref: any) => snap(ref.path),
  updateDoc: async (ref: any, d: any) => state.set(ref.path, { ...(state.get(ref.path) || {}), ...d }),
  writeBatch: () => ({ set: () => {}, update: () => {}, commit: async () => {} }),
  runTransaction: (_db: unknown, fn: (tx: any) => Promise<any>) => {
    const run = txChain.then(async () => {
      const ops: (() => void)[] = [];
      const ret = await fn({
        get: async (ref: any) => snap(ref.path),
        set: (ref: any, d: any) => ops.push(() => state.set(ref.path, d)),
        update: (ref: any, d: any) => ops.push(() => state.set(ref.path, { ...(state.get(ref.path) || {}), ...d })),
      });
      ops.forEach((f) => f());
      return ret;
    });
    txChain = run.catch(() => {});
    return run;
  },
  Timestamp: class Timestamp {},
  collection: () => ({}), getDocs: async () => ({ docs: [] }), query: () => ({}), where: () => ({}),
  orderBy: () => ({}), deleteField: () => ({}), arrayUnion: () => ({}), arrayRemove: () => ({}), setDoc: async () => {},
}));
vi.mock("@/lib/firebase/client", () => ({ db: {}, auth: {} }));
vi.mock("@/lib/analytics/applyReceiptDeltaServerFirst", () => ({ applyReceiptDeltaServerFirst: async () => ({ appliedViaServer: true }) }));
vi.mock("@/lib/analytics/applyAnalyticsDeltaV2", () => ({ applyAnalyticsDeltaV2: async () => {} }));
vi.mock("@/lib/analytics/applyKdsTicketDelta", () => ({ applyKdsTicketDelta: async () => {} }));
vi.mock("@/lib/analytics/applyKdsDeltaServerFirst", () => ({ applyKdsDeltaServerFirst: async () => {} }));
vi.mock("@/lib/printing/kitchenBackupPrint", () => ({ printKitchenTicketBackup: async () => {} }));
vi.mock("@/lib/printing/kitchenBackupDeps", () => ({ makeKitchenBackupDeps: () => ({}) }));
vi.mock("@/components/cashier/activity-log", () => ({ writeActivityLog: async () => {} }));
vi.mock("@/lib/offline/kitchenTicketWrites", () => ({ selectTicketWriter: () => ({}) }));
vi.mock("@/lib/offline/commit", () => ({ commitLocalFirst: async () => {} }));
vi.mock("@/lib/offline/sessionOwnership", () => ({ sessionOwnershipFields: () => ({}) }));
vi.mock("@/lib/offline/browserDevice", () => ({ getBrowserDeviceId: () => "dev" }));
vi.mock("@/lib/server-profiles/activeLocalProfile", () => ({ getActiveLocalProfile: () => null }));
vi.mock("@/context/auth-context", () => ({}));

import { createRefundReceipt } from "./firestore";
import { getPaymentContribution, getSalesContribution } from "@/lib/analytics/daily";

const ORIG = "stores/a/receipts/original";
const actor = { uid: "staff", username: "Staff" } as any;
const line = { id: "line", type: "addon", itemId: "inv1", itemName: "Mock", category: "Food", qtyOrdered: 1, freeQty: 0, voidedQty: 0, unitPrice: 100 };
const parent = {
  id: "original", receiptId: "original", storeId: "a", sessionId: "s", status: "final", sessionMode: "alacarte",
  total: 80, receiptNumber: "001", createdAtClientMs: 1793224800000, lines: [line],
  analytics: { v: 2, grandTotal: 80, discountsTotal: 20, chargesTotal: 0, taxAmount: 0, mop: { Cash: 80 } },
} as any;

const refunds = () => [...state.entries()].filter(([p]) => p.startsWith("stores/a/receipts/rf-")).map(([, v]) => v);

beforeEach(() => {
  state.clear();
  state.set(ORIG, structuredClone(parent));
});

describe("createRefundReceipt (B11/B12/B13)", () => {
  it("discounted 80 sale refunds exactly 80, with a negative cash tender snapshot", async () => {
    await createRefundReceipt("a", parent, { line: 1 }, actor, "test", "rf-1");
    const [rf] = refunds();
    expect(rf.total).toBe(-80);
    expect(rf.totalPaid).toBe(-80);
    expect(rf.analytics.mop).toEqual({ Cash: -80 });
    expect(rf.analytics.discountsTotal).toBe(-20);
    expect(state.get(ORIG).totalRefunded).toBe(80);
    expect(state.get(ORIG).refundedMop).toEqual({ Cash: 80 });
    // Drawer: sale + refund leaves the cash method at zero.
    expect(getPaymentContribution(parent).byMethod.Cash + getPaymentContribution(rf).byMethod.Cash).toBe(0);
    // Items: sale + refund nets to zero.
    const s = getSalesContribution(parent).addonSalesByItem.Mock;
    const r = getSalesContribution(rf).addonSalesByItem.Mock;
    expect(s.qty + r.qty).toBe(0);
    expect(s.amount + r.amount).toBe(0);
  });

  it("two concurrent refunds of the one sold unit: exactly one succeeds", async () => {
    const results = await Promise.allSettled([
      createRefundReceipt("a", parent, { line: 1 }, actor, "x", "rf-a"),
      createRefundReceipt("a", parent, { line: 1 }, actor, "x", "rf-b"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(refunds()).toHaveLength(1);
    expect(state.get(ORIG).totalRefunded).toBe(80);
    expect(state.get(ORIG).refundedQtys).toEqual({ line: 1 });
  });

  it("retrying the same request id creates no second refund or increment", async () => {
    const id1 = await createRefundReceipt("a", parent, { line: 1 }, actor, "x", "rf-same");
    const id2 = await createRefundReceipt("a", parent, { line: 1 }, actor, "x", "rf-same");
    expect(id1).toBe(id2);
    expect(refunds()).toHaveLength(1);
    expect(state.get(ORIG).refundCount).toBe(1);
  });

  it("refuses a voided original", async () => {
    state.set(ORIG, { ...structuredClone(parent), status: "voided" });
    await expect(createRefundReceipt("a", parent, { line: 1 }, actor, "x", "rf-v")).rejects.toThrow(/voided/);
    expect(refunds()).toHaveLength(0);
  });
});
