import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Regression tests for audit findings B07–B10 (phase1 backend audit
 * 2026-10-29). Each probe that used to succeed is now asserted to be refused,
 * plus the legitimate flows (checkout earn, pre-payment removal, session void,
 * finalize after payment) that must keep working.
 */

// --- in-memory firestore double --------------------------------------------

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
  return {
    path,
    id: path.split("/").pop(),
    get: async () => snap(path),
    collection: (c: string) => colRef(`${path}/${c}`),
  };
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
  batch: () => {
    const ops: Array<() => void> = [];
    return {
      set: (r: any, d: Doc, o?: any) => ops.push(() => mutate(r.path, d, !!o?.merge)),
      update: (r: any, d: Doc) => ops.push(() => update(r.path, d)),
      commit: async () => ops.forEach((f) => f()),
    };
  },
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

import { writeLoyaltyEarn, writeLoyaltyRedeem, reverseLoyaltyRedeem, finalizeLoyaltyVouchers } from "./loyalty";

const PHONE = "+639171234567";
const seed = (docs: Record<string, Doc>) => {
  for (const [p, d] of Object.entries(docs)) h.state.set(p, d);
};
const get = (p: string) => h.state.get(p);

beforeEach(() => {
  h.state = new Map();
  h.seq = 0;
});

// --- B07: earn ---------------------------------------------------------------

describe("B07 writeLoyaltyEarn", () => {
  const paidSale = () =>
    seed({
      "stores/a": { name: "Store A" },
      [`customers/${PHONE}`]: { name: "Mock", pointsBalance: 0 },
      "stores/a/sessions/s1": { status: "closed", isPaid: true, linkedCustomerPhone: PHONE },
      "stores/a/receipts/s1": { sessionId: "s1", storeId: "a", status: "final", total: 1500 },
    });

  it("probe: earning against a nonexistent receipt/session credits nothing", async () => {
    seed({ "stores/a": {}, [`customers/${PHONE}`]: { pointsBalance: 0 } });
    const r1 = await writeLoyaltyEarn({ storeId: "a", sessionId: "missing", phone: PHONE, receiptId: "nope", staffUid: "staff" });
    const r2 = await writeLoyaltyEarn({ storeId: "a", sessionId: "missing", phone: PHONE, receiptId: "nope", staffUid: "staff" });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(get(`customers/${PHONE}`)!.pointsBalance).toBe(0);
  });

  it("requires a receiptId", async () => {
    paidSale();
    const r = await writeLoyaltyEarn({ storeId: "a", receiptId: "", staffUid: "staff" } as any);
    expect(r.ok).toBe(false);
    expect(get(`customers/${PHONE}`)!.pointsBalance).toBe(0);
  });

  it("earns from the receipt total (body amount ignored) and repeats are no-ops", async () => {
    paidSale();
    const r1 = await writeLoyaltyEarn({ storeId: "a", sessionId: "s1", phone: "0917 123 4567", receiptId: "s1", staffUid: "staff" });
    expect(r1).toMatchObject({ ok: true, points: 15 });
    const r2 = await writeLoyaltyEarn({ storeId: "a", sessionId: "s1", phone: PHONE, receiptId: "s1", staffUid: "staff" });
    expect(r2).toMatchObject({ ok: true, duplicate: true });
    expect(get(`customers/${PHONE}`)!.pointsBalance).toBe(15);
    expect(get("stores/a/sessions/s1")!.linkedCustomerLockedAt).toBeDefined();
  });

  it("refuses voided and refund receipts", async () => {
    paidSale();
    seed({ "stores/a/receipts/s1": { sessionId: "s1", status: "voided", total: 1500 } });
    expect((await writeLoyaltyEarn({ storeId: "a", receiptId: "s1", staffUid: "staff" })).ok).toBe(false);
    seed({ "stores/a/receipts/rf": { sessionId: "s1", status: "final", isRefund: true, parentReceiptId: "s1", total: -1500 } });
    expect((await writeLoyaltyEarn({ storeId: "a", receiptId: "rf", staffUid: "staff" })).ok).toBe(false);
    expect(get(`customers/${PHONE}`)!.pointsBalance).toBe(0);
  });

  it("refuses a phone that is not the card linked to the sale", async () => {
    paidSale();
    seed({ "customers/+639998887777": { pointsBalance: 0 } });
    const r = await writeLoyaltyEarn({ storeId: "a", receiptId: "s1", phone: "+639998887777", staffUid: "staff" });
    expect(r.ok).toBe(false);
    expect(get("customers/+639998887777")!.pointsBalance).toBe(0);
    expect(get(`customers/${PHONE}`)!.pointsBalance).toBe(0);
  });

  it("refuses a sale with no linked card, and a mismatched session id", async () => {
    paidSale();
    seed({ "stores/a/sessions/s1": { status: "closed", isPaid: true } });
    expect((await writeLoyaltyEarn({ storeId: "a", receiptId: "s1", phone: PHONE, staffUid: "staff" })).ok).toBe(false);
    paidSale();
    expect((await writeLoyaltyEarn({ storeId: "a", receiptId: "s1", sessionId: "other", staffUid: "staff" })).ok).toBe(false);
    expect(get(`customers/${PHONE}`)!.pointsBalance).toBe(0);
  });

  it("honours a pre-hardening earn stored under the receipt id", async () => {
    paidSale();
    seed({ [`customers/${PHONE}/pointsLedger/s1`]: { type: "earn", points: 15 } });
    const r = await writeLoyaltyEarn({ storeId: "a", receiptId: "s1", staffUid: "staff" });
    expect(r).toMatchObject({ ok: true, duplicate: true });
    expect(get(`customers/${PHONE}`)!.pointsBalance).toBe(0);
  });
});

// --- B08: redeem respects reserved points -------------------------------------

describe("B08 writeLoyaltyRedeem", () => {
  const base = (balance: number, reserved: number) =>
    seed({
      "customers/p": { pointsBalance: balance, pointsReserved: reserved },
      "loyaltyRewards/r": { pointsCost: 10, value: 20, name: "Mock" },
      "stores/a/sessions/s": { status: "active" },
    });

  it("probe: cannot spend points already held by a Hub voucher", async () => {
    base(10, 10);
    const res = await writeLoyaltyRedeem({ storeId: "a", sessionId: "s", phone: "p", rewardId: "r", staffUid: "staff" });
    expect(res).toMatchObject({ ok: false, error: "Insufficient points" });
    expect(get("customers/p")!.pointsBalance).toBe(10);
  });

  it("spends unheld points", async () => {
    base(20, 10);
    const res = await writeLoyaltyRedeem({ storeId: "a", sessionId: "s", phone: "p", rewardId: "r", staffUid: "staff" });
    expect(res.ok).toBe(true);
    expect(get("customers/p")!.pointsBalance).toBe(10);
  });
});

// --- B09: finalize ----------------------------------------------------------------

describe("B09 finalizeLoyaltyVouchers", () => {
  const hubApplied = (over: Doc = {}) => ({
    status: "applied", source: "hub", phone: "p", pointsCost: 10, reservedPoints: 10, pointsSpent: false,
    appliedStoreId: "a", appliedSessionId: "s", appliedReceiptId: null, ...over,
  });
  const paid = (voucher: Doc) =>
    seed({
      "stores/a/sessions/s": { status: "closed", isPaid: true, loyaltyRedemptions: [{ redemptionId: "v" }] },
      "stores/a/receipts/s": { sessionId: "s", status: "final", total: 100, loyaltyRedemptions: [{ redemptionId: "v" }] },
      "loyaltyRedemptions/v": voucher,
      "customers/p": { pointsBalance: 100, pointsReserved: 10 },
    });

  it("probe: cancelled foreign voucher against a nonexistent receipt is not finalized", async () => {
    seed({
      "stores/a/sessions/s": { status: "active", loyaltyRedemptions: [{ redemptionId: "v" }] },
      "loyaltyRedemptions/v": { status: "cancelled", phone: "p", pointsCost: 10, reservedPoints: 0, pointsSpent: false, appliedStoreId: "b", appliedSessionId: "other" },
      "customers/p": { pointsBalance: 100 },
    });
    const res = await finalizeLoyaltyVouchers({ storeId: "a", sessionId: "s", receiptId: "nonexistent" });
    expect(res.ok).toBe(false);
    expect(res.finalized).toBe(0);
    expect(get("customers/p")!.pointsBalance).toBe(100);
    expect(get("loyaltyRedemptions/v")!.status).toBe("cancelled");
  });

  it("skips cancelled / foreign vouchers even with a real paid receipt", async () => {
    paid(hubApplied({ status: "cancelled" }));
    let res = await finalizeLoyaltyVouchers({ storeId: "a", sessionId: "s", receiptId: "s" });
    expect(res).toMatchObject({ ok: true, finalized: 0, skipped: ["v"] });
    paid(hubApplied({ appliedStoreId: "b", appliedSessionId: "other" }));
    res = await finalizeLoyaltyVouchers({ storeId: "a", sessionId: "s", receiptId: "s" });
    expect(res).toMatchObject({ ok: true, finalized: 0 });
    expect(get("customers/p")!.pointsBalance).toBe(100);
    expect(get("loyaltyRedemptions/v")!.appliedReceiptId).toBeNull();
  });

  it("skips a voucher removed from the session after payment snapshot", async () => {
    paid(hubApplied());
    seed({ "stores/a/sessions/s": { status: "closed", isPaid: true, loyaltyRedemptions: [] } });
    const res = await finalizeLoyaltyVouchers({ storeId: "a", sessionId: "s", receiptId: "s" });
    expect(res.finalized).toBe(0);
    expect(get("customers/p")!.pointsBalance).toBe(100);
  });

  it("missing session or unpaid session is not reported as success", async () => {
    paid(hubApplied());
    h.state.delete("stores/a/sessions/s");
    expect((await finalizeLoyaltyVouchers({ storeId: "a", sessionId: "s", receiptId: "s" })).ok).toBe(false);
    paid(hubApplied());
    seed({ "stores/a/sessions/s": { status: "active", loyaltyRedemptions: [{ redemptionId: "v" }] } });
    expect((await finalizeLoyaltyVouchers({ storeId: "a", sessionId: "s", receiptId: "s" })).ok).toBe(false);
    seed({ "stores/a/sessions/s": { status: "closed", isPaid: true, loyaltyRedemptions: [{ redemptionId: "v" }] }, "stores/a/receipts/s": { sessionId: "s", status: "voided", loyaltyRedemptions: [{ redemptionId: "v" }] } });
    expect((await finalizeLoyaltyVouchers({ storeId: "a", sessionId: "s", receiptId: "s" })).ok).toBe(false);
    expect(get("customers/p")!.pointsBalance).toBe(100);
  });

  it("skips when the customer's hold is gone (no negative balance)", async () => {
    paid(hubApplied());
    seed({ "customers/p": { pointsBalance: 100, pointsReserved: 0 } });
    const res = await finalizeLoyaltyVouchers({ storeId: "a", sessionId: "s", receiptId: "s" });
    expect(res.finalized).toBe(0);
    expect(get("customers/p")).toMatchObject({ pointsBalance: 100, pointsReserved: 0 });
  });

  it("finalizes a held Hub voucher on a paid receipt once", async () => {
    paid(hubApplied());
    expect(await finalizeLoyaltyVouchers({ storeId: "a", sessionId: "s", receiptId: "s" })).toMatchObject({ ok: true, finalized: 1 });
    expect(get("customers/p")).toMatchObject({ pointsBalance: 90, pointsReserved: 0 });
    expect(get("loyaltyRedemptions/v")).toMatchObject({ appliedReceiptId: "s", pointsSpent: true, reservedPoints: 0 });
    expect(await finalizeLoyaltyVouchers({ storeId: "a", sessionId: "s", receiptId: "s" })).toMatchObject({ ok: true, finalized: 0 });
    expect(get("customers/p")!.pointsBalance).toBe(90);
  });
});

// --- B10: reverse -----------------------------------------------------------------

describe("B10 reverseLoyaltyRedeem", () => {
  const posRedemption = (over: Doc = {}) => ({
    status: "applied", source: "pos", phone: "p", pointsCost: 10, pointsSpent: true, reservedPoints: 0,
    appliedStoreId: "a", appliedSessionId: "s", appliedReceiptId: null, rewardId: "r", ...over,
  });

  it("probe: 'removed' on a paid receipt refunds nothing", async () => {
    seed({
      "stores/a/sessions/s": { status: "closed", isPaid: true, loyaltyRedemptions: [{ redemptionId: "v" }] },
      "loyaltyRedemptions/v": posRedemption({ appliedReceiptId: "paid-receipt" }),
      "customers/p": { pointsBalance: 0 },
    });
    const res = await reverseLoyaltyRedeem("v", "staff", "removed", { authorize: async () => {} });
    expect(res.ok).toBe(false);
    expect(get("customers/p")!.pointsBalance).toBe(0);
    expect(get("loyaltyRedemptions/v")!.status).toBe("applied");
  });

  it("a paid-but-not-yet-finalized Hub voucher cannot be made active again", async () => {
    seed({
      "stores/a/sessions/s": { status: "closed", isPaid: true, loyaltyRedemptions: [{ redemptionId: "v" }] },
      "loyaltyRedemptions/v": posRedemption({ source: "hub", pointsSpent: false, reservedPoints: 10 }),
      "customers/p": { pointsBalance: 100, pointsReserved: 10 },
    });
    const res = await reverseLoyaltyRedeem("v", "staff", "removed");
    expect(res.ok).toBe(false);
    expect(get("loyaltyRedemptions/v")!.status).toBe("applied");
  });

  it("rejects unknown reasons", async () => {
    seed({ "stores/a/sessions/s": { status: "active" }, "loyaltyRedemptions/v": posRedemption(), "customers/p": { pointsBalance: 0 } });
    expect((await reverseLoyaltyRedeem("v", "staff", "whatever")).ok).toBe(false);
    expect(get("customers/p")!.pointsBalance).toBe(0);
  });

  it("pre-payment removal and session void still refund (legit flows)", async () => {
    seed({
      "stores/a/sessions/s": { status: "active", loyaltyRedemptions: [{ redemptionId: "v" }] },
      "loyaltyRedemptions/v": posRedemption(),
      "customers/p": { pointsBalance: 0 },
    });
    expect(await reverseLoyaltyRedeem("v", "staff", "removed")).toMatchObject({ ok: true, refunded: 10 });
    expect(get("customers/p")!.pointsBalance).toBe(10);
    expect(get("stores/a/sessions/s")!.loyaltyRedemptions).toEqual([]);

    seed({
      "stores/a/sessions/s2": { status: "voided", loyaltyRedemptions: [{ redemptionId: "w" }] },
      "loyaltyRedemptions/w": posRedemption({ appliedSessionId: "s2" }),
    });
    expect(await reverseLoyaltyRedeem("w", "staff", "void")).toMatchObject({ ok: true, refunded: 10 });
    expect(get("customers/p")!.pointsBalance).toBe(20);
  });

  it("pre-payment removal of a Hub voucher returns it to active", async () => {
    seed({
      "stores/a/sessions/s": { status: "active", loyaltyRedemptions: [{ redemptionId: "v" }] },
      "loyaltyRedemptions/v": posRedemption({ source: "hub", pointsSpent: false, reservedPoints: 10 }),
    });
    expect(await reverseLoyaltyRedeem("v", "staff", "removed")).toMatchObject({ ok: true, refunded: 0 });
    expect(get("loyaltyRedemptions/v")).toMatchObject({ status: "active", appliedSessionId: null });
  });

  it("receipt_void requires the original receipt to be voided; refunds once", async () => {
    seed({
      "stores/a/sessions/s": { status: "closed", isPaid: true, loyaltyRedemptions: [{ redemptionId: "v" }] },
      "stores/a/receipts/s": { sessionId: "s", status: "final" },
      "loyaltyRedemptions/v": posRedemption({ appliedReceiptId: "s" }),
      "customers/p": { pointsBalance: 0 },
    });
    expect((await reverseLoyaltyRedeem("v", "staff", "receipt_void")).ok).toBe(false);
    expect(get("customers/p")!.pointsBalance).toBe(0);

    seed({ "stores/a/receipts/s": { sessionId: "s", status: "voided" } });
    expect(await reverseLoyaltyRedeem("v", "staff", "receipt_void")).toMatchObject({ ok: true, refunded: 10 });
    expect(await reverseLoyaltyRedeem("v", "staff", "receipt_void")).toMatchObject({ ok: true, refunded: 0 });
    expect(get("customers/p")!.pointsBalance).toBe(10);
  });

  it("refund requires a refund receipt tied to the original sale", async () => {
    seed({
      "stores/a/sessions/s": { status: "closed", isPaid: true },
      "stores/a/receipts/s": { sessionId: "s", status: "final" },
      "stores/a/receipts/rf-other": { isRefund: true, status: "final", parentReceiptId: "someone-else" },
      "stores/a/receipts/rf": { isRefund: true, status: "final", parentReceiptId: "s" },
      "loyaltyRedemptions/v": posRedemption({ appliedReceiptId: "s" }),
      "customers/p": { pointsBalance: 0 },
    });
    expect((await reverseLoyaltyRedeem("v", "staff", "refund")).ok).toBe(false);
    expect((await reverseLoyaltyRedeem("v", "staff", "refund", { refundReceiptId: "rf-other" })).ok).toBe(false);
    expect(get("customers/p")!.pointsBalance).toBe(0);
    expect(await reverseLoyaltyRedeem("v", "staff", "refund", { refundReceiptId: "rf" })).toMatchObject({ ok: true, refunded: 10 });
  });

  it("re-checks the redemption's store inside the transaction", async () => {
    seed({ "stores/a/sessions/s": { status: "active" }, "loyaltyRedemptions/v": posRedemption(), "customers/p": { pointsBalance: 0 } });
    const res = await reverseLoyaltyRedeem("v", "staff", "removed", {
      authorize: async () => {
        // Redemption moves to another store between authorize and the tx.
        seed({ "loyaltyRedemptions/v": posRedemption({ appliedStoreId: "b" }) });
      },
    });
    expect(res.ok).toBe(false);
    expect(get("customers/p")!.pointsBalance).toBe(0);
  });
});
