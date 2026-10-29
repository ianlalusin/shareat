import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Audit B07 (phase1 backend 2026-10-29), remaining part: points earned on a
 * paid receipt are taken back when it is voided or refunded, and vouchers used
 * on it are returned on void / full refund. Same in-memory Firestore double as
 * loyalty.test.ts.
 */

type Doc = Record<string, any>;
const h: { state: Map<string, Doc>; seq: number } = { state: new Map(), seq: 0 };

const inc = (n: number) => ({ __inc: n });
const isInc = (v: any) => v && typeof v === "object" && "__inc" in v;

function mutate(path: string, data: Doc, merge: boolean) {
  const next: Doc = merge ? { ...(h.state.get(path) ?? {}) } : {};
  for (const [k, v] of Object.entries(data)) next[k] = isInc(v) ? (Number(next[k]) || 0) + v.__inc : v;
  h.state.set(path, next);
}
function update(path: string, data: Doc) {
  if (!h.state.has(path)) throw new Error(`NOT_FOUND: ${path}`);
  mutate(path, data, true);
}
function docRef(path: string): any {
  return { path, id: path.split("/").pop(), get: async () => snap(path), collection: (c: string) => colRef(`${path}/${c}`) };
}
function colRef(path: string): any {
  return {
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++h.seq}`}`),
    where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
  };
}
function snap(path: string) {
  const d = h.state.get(path);
  return { exists: d !== undefined, id: path.split("/").pop(), data: () => (d ? { ...d } : undefined) };
}
const db = {
  doc: (p: string) => docRef(p),
  collection: (p: string) => colRef(p),
  runTransaction: async (fn: (tx: any) => Promise<any>) => {
    const ops: Array<() => void> = [];
    const ret = await fn({
      get: async (r: any) => snap(r.path),
      set: (r: any, d: Doc, o?: any) => ops.push(() => mutate(r.path, d, !!o?.merge)),
      update: (r: any, d: Doc) => ops.push(() => update(r.path, d)),
    });
    ops.forEach((f) => f());
    return ret;
  },
};

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => db }));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { increment: (n: number) => inc(n), serverTimestamp: () => "ts" },
}));
vi.mock("@/lib/server/loyaltyLog", () => ({ appendLogToProjection: async () => {} }));
vi.mock("@/lib/loyaltyRewardScope", () => ({ isRewardOfferedAtStore: () => true }));

import { writeLoyaltyEarn, reverseLoyaltyEarn, reverseLoyaltyForReceipt } from "./loyalty";

const PHONE = "+639171234567";
const C = `customers/${PHONE}`;
const seed = (docs: Record<string, Doc>) => {
  for (const [p, d] of Object.entries(docs)) h.state.set(p, d);
};
const get = (p: string) => h.state.get(p);
const patch = (p: string, d: Doc) => seed({ [p]: { ...get(p), ...d } });

beforeEach(() => {
  h.state = new Map();
  h.seq = 0;
});

describe("B07 reverseLoyaltyEarn", () => {
  const earned = async (over: Doc = {}) => {
    seed({
      "stores/a": { name: "Store A" },
      [C]: { name: "Mock", pointsBalance: 100, ...over },
      "stores/a/sessions/s1": { status: "closed", isPaid: true, linkedCustomerPhone: PHONE },
      "stores/a/receipts/s1": { sessionId: "s1", storeId: "a", status: "final", total: 1500 },
    });
    expect(await writeLoyaltyEarn({ storeId: "a", receiptId: "s1", staffUid: "staff" })).toMatchObject({ ok: true, points: 15 });
  };
  const voidIt = () => patch("stores/a/receipts/s1", { status: "voided" });
  const refund = (id: string, total: number, over: Doc = {}) =>
    seed({ [`stores/a/receipts/${id}`]: { isRefund: true, parentReceiptId: "s1", status: "final", sessionId: "s1", total: -total, ...over } });
  const rev = (reason: string, refundReceiptId?: string) =>
    reverseLoyaltyEarn({ storeId: "a", receiptId: "s1", staffUid: "m", reason, refundReceiptId });

  it("refuses until the receipt is actually voided", async () => {
    await earned();
    expect(await rev("receipt_void")).toMatchObject({ ok: false, precondition: true });
    expect(get(C)!.pointsBalance).toBe(115);
  });

  it("void takes back the whole earn once (deterministic ledger id)", async () => {
    await earned();
    voidIt();
    expect(await rev("receipt_void")).toMatchObject({ ok: true, reversed: 15, shortfall: 0 });
    expect(await rev("receipt_void")).toMatchObject({ ok: true, duplicate: true });
    expect(get(C)!.pointsBalance).toBe(100);
    expect(get(`${C}/pointsLedger/earn_void_a__s1`)).toMatchObject({ type: "earn_reversal", points: -15, requestedPoints: 15, shortfall: 0 });
    expect(get("loyaltyStats/global")!.totalPointsOutstanding).toBe(0);
  });

  it("partial refunds reverse proportionally and converge on the full earn", async () => {
    await earned();
    refund("rf1", 500); // 500/1500 of 15 = 5
    expect(await rev("refund", "rf1")).toMatchObject({ ok: true, reversed: 5 });
    expect(await rev("refund", "rf1")).toMatchObject({ ok: true, duplicate: true });
    expect(get(C)!.pointsBalance).toBe(110);
    refund("rf2", 100); // running 600/1500 -> 6 total -> +1
    expect(await rev("refund", "rf2")).toMatchObject({ reversed: 1 });
    refund("rf3", 900); // fully refunded -> remaining 9
    expect(await rev("refund", "rf3")).toMatchObject({ reversed: 9 });
    expect(get(C)!.pointsBalance).toBe(100);
    expect(get(`${C}/pointsLedger/earn_refund_a__rf3`)).toMatchObject({ points: -9, receiptId: "s1", refundReceiptId: "rf3" });
  });

  it("void after a partial refund takes back only what is left", async () => {
    await earned();
    refund("rf1", 500);
    await rev("refund", "rf1");
    voidIt();
    expect(await rev("receipt_void")).toMatchObject({ reversed: 10 });
    expect(get(C)!.pointsBalance).toBe(100);
  });

  it("never goes negative: clamps at spendable points and records the shortfall", async () => {
    await earned({ pointsBalance: 0, pointsReserved: 10 }); // after earn: balance 15, held 10 -> spendable 5
    voidIt();
    expect(await rev("receipt_void")).toMatchObject({ ok: true, reversed: 5, requested: 15, shortfall: 10 });
    expect(get(C)!.pointsBalance).toBe(10);
    expect(get(`${C}/pointsLedger/earn_void_a__s1`)).toMatchObject({ points: -5, shortfall: 10 });
    expect(get("loyaltyEarnReceipts/a__s1")).toMatchObject({ reversedPoints: 15, deductedPoints: 5, shortfallPoints: 10 });
    expect(get("loyaltyStats/global")!.totalPointsReversalShortfall).toBe(10);
  });

  it("refund receipt must belong to this sale; a receipt that never earned is a no-op", async () => {
    await earned();
    refund("rfx", 500, { parentReceiptId: "other" });
    expect(await rev("refund", "rfx")).toMatchObject({ ok: false, precondition: true });
    expect(await rev("bogus")).toMatchObject({ ok: false });
    expect(get(C)!.pointsBalance).toBe(115);
    seed({ "stores/a/receipts/s2": { sessionId: "s2", status: "voided", total: 100 } });
    expect(await reverseLoyaltyEarn({ storeId: "a", receiptId: "s2", staffUid: "m", reason: "receipt_void" })).toMatchObject({ ok: true, noEarn: true, reversed: 0 });
  });

  it("finds the card for an older marker that has no phone", async () => {
    await earned();
    const { phone: _p, ...old } = get("loyaltyEarnReceipts/a__s1")!;
    seed({ "loyaltyEarnReceipts/a__s1": old });
    voidIt();
    expect(await rev("receipt_void")).toMatchObject({ reversed: 15 });
    expect(get(C)!.pointsBalance).toBe(100);
  });

  it("reverses a pre-hardening earn stored under the receipt id", async () => {
    seed({
      [C]: { name: "Mock", pointsBalance: 115 },
      [`${C}/pointsLedger/s1`]: { type: "earn", points: 15, amount: 1500 },
      "stores/a/sessions/s1": { status: "closed", isPaid: true, linkedCustomerPhone: PHONE },
      "stores/a/receipts/s1": { sessionId: "s1", status: "voided", total: 1500 },
    });
    expect(await rev("receipt_void")).toMatchObject({ ok: true, reversed: 15 });
    expect(await rev("receipt_void")).toMatchObject({ duplicate: true });
    expect(get(C)!.pointsBalance).toBe(100);
  });
});

describe("B07 reverseLoyaltyForReceipt (points + vouchers)", () => {
  const setup = async (voucherStore = "a") => {
    seed({
      "stores/a": { name: "Store A" },
      [C]: { name: "Mock", pointsBalance: 100 },
      "stores/a/sessions/s1": { status: "closed", isPaid: true, linkedCustomerPhone: PHONE },
      "stores/a/receipts/s1": { sessionId: "s1", status: "final", total: 1500, loyaltyRedemptions: [{ redemptionId: "v" }] },
      "loyaltyRedemptions/v": {
        status: "applied", source: "pos", phone: PHONE, pointsCost: 20, pointsSpent: true, reservedPoints: 0,
        appliedStoreId: voucherStore, appliedSessionId: "s1", appliedReceiptId: "s1", rewardId: "r",
      },
    });
    await writeLoyaltyEarn({ storeId: "a", receiptId: "s1", staffUid: "staff" }); // 100 + 15
  };

  it("void reverses the earn and returns the voucher's points", async () => {
    await setup();
    patch("stores/a/receipts/s1", { status: "voided" });
    const r = await reverseLoyaltyForReceipt({ storeId: "a", receiptId: "s1", staffUid: "m", reason: "receipt_void" });
    expect(r).toMatchObject({ ok: true, vouchers: { reversed: ["v"], failed: [] } });
    expect(get(C)!.pointsBalance).toBe(120); // 115 - 15 + 20
    expect(get("loyaltyRedemptions/v")!.status).toBe("cancelled");
  });

  it("partial refund keeps the voucher; full refund returns it", async () => {
    await setup();
    seed({ "stores/a/receipts/rf1": { isRefund: true, parentReceiptId: "s1", status: "final", total: -500 } });
    patch("stores/a/receipts/s1", { totalRefunded: 500 });
    let r = await reverseLoyaltyForReceipt({ storeId: "a", receiptId: "s1", staffUid: "m", reason: "refund", refundReceiptId: "rf1" });
    expect(r).toMatchObject({ ok: true, vouchers: { reversed: [], deferred: true } });
    expect(get("loyaltyRedemptions/v")!.status).toBe("applied");
    expect(get(C)!.pointsBalance).toBe(110);
    seed({ "stores/a/receipts/rf2": { isRefund: true, parentReceiptId: "s1", status: "final", total: -1000 } });
    patch("stores/a/receipts/s1", { totalRefunded: 1500 });
    r = await reverseLoyaltyForReceipt({ storeId: "a", receiptId: "s1", staffUid: "m", reason: "refund", refundReceiptId: "rf2" });
    expect(r).toMatchObject({ ok: true, vouchers: { reversed: ["v"] } });
    expect(get(C)!.pointsBalance).toBe(120);
  });

  it("stops on an invalid void and never touches another store's voucher", async () => {
    await setup("b");
    expect((await reverseLoyaltyForReceipt({ storeId: "a", receiptId: "s1", staffUid: "m", reason: "receipt_void" })).ok).toBe(false);
    expect(get(C)!.pointsBalance).toBe(115);
    patch("stores/a/receipts/s1", { status: "voided" });
    const r = await reverseLoyaltyForReceipt({ storeId: "a", receiptId: "s1", staffUid: "m", reason: "receipt_void" });
    expect(r.ok).toBe(false);
    expect(r.vouchers.failed[0]).toMatchObject({ redemptionId: "v" });
    expect(get("loyaltyRedemptions/v")!.status).toBe("applied");
    expect(get(C)!.pointsBalance).toBe(100); // the earn is still reversed
  });
});
