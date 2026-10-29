import { describe, it, expect, beforeEach, vi } from "vitest";

const state = new Map<string, any>();
let reversals = 0;
let retainedReversed = 0;

const db = {
  doc: (p: string) => ({ path: p, id: p.split("/").pop() }),
  runTransaction: async (fn: (tx: any) => Promise<any>) => {
    const ops: (() => void)[] = [];
    const ret = await fn({
      get: async (ref: any) => ({ id: ref.id, exists: state.has(ref.path), data: () => state.get(ref.path) }),
      set: (ref: any, d: any) => ops.push(() => {
        if (ref.path.includes("/analytics/")) retainedReversed += -(d?.payments?.voidCashRetainedTotal?.increment ?? 0);
      }),
      update: (ref: any, d: any) => ops.push(() => state.set(ref.path, { ...(state.get(ref.path) || {}), ...d })),
    });
    ops.forEach((f) => f());
    return ret;
  },
};

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { increment: (n: number) => ({ increment: n }), serverTimestamp: () => ({ ts: true }) },
}));
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => db,
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: "staff" }) }),
}));
vi.mock("@/lib/server/staff-access", () => ({ requireStaffStoreAccess: async () => ({ role: "cashier" }) }));
vi.mock("@/lib/server/analytics/applyAnalyticsDeltaServer", () => ({
  applyAnalyticsDeltaServer: (_db: any, _s: any, old: any, next: any) => { if (old && !next) reversals++; },
}));
vi.mock("@/lib/server/analytics/applyDailySessionRowServer", () => ({
  removeDailySessionRow: () => {}, upsertDailySessionRow: () => {},
}));

import { POST } from "./route";

const req = (body: any) =>
  new Request("http://localhost/api/analytics/apply-delta", {
    method: "POST",
    headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const R = (id: string) => `stores/a/receipts/${id}`;

beforeEach(() => {
  state.clear();
  reversals = 0;
  retainedReversed = 0;
});

describe("apply-delta op=void (B04)", () => {
  it("rejects reversing a receipt that is still final", async () => {
    state.set(R("r"), { status: "final", total: 100, analyticsApplied: true, createdAtClientMs: 1793224800000 });
    const res = await POST(req({ storeId: "a", receiptId: "r", op: "void" }));
    expect(res.status).toBe(409);
    expect(reversals).toBe(0);
    expect(state.get(R("r")).analyticsReversed).toBeUndefined();
  });

  it("reverses a receipt the void flow already marked voided", async () => {
    state.set(R("r"), { status: "voided", total: 100, analyticsApplied: true, analyticsReversed: false, createdAtClientMs: 1793224800000, lines: [] });
    const res = await POST(req({ storeId: "a", receiptId: "r", op: "void" }));
    expect(res.status).toBe(200);
    expect(reversals).toBe(1);
    expect(state.get(R("r")).analyticsReversed).toBe(true);
  });
});

describe("apply-delta op=voidcash-reverse (B04)", () => {
  const voided = { status: "voided", voidCashRetained: 50, createdAtClientMs: 1793224800000 };

  it("rejects a nonexistent re-ring receipt", async () => {
    state.set(R("v"), { ...voided });
    const res = await POST(req({ storeId: "a", receiptId: "v", op: "voidcash-reverse", reRingReceiptId: "ghost" }));
    expect(res.status).toBe(409);
    expect(retainedReversed).toBe(0);
    expect(state.get(R("v")).voidCashRetainedReversed).toBeUndefined();
  });

  it("rejects a voided or refund re-ring, and a final source receipt", async () => {
    state.set(R("v"), { ...voided });
    state.set(R("x"), { status: "voided" });
    state.set(R("rf"), { status: "final", isRefund: true });
    expect((await POST(req({ storeId: "a", receiptId: "v", op: "voidcash-reverse", reRingReceiptId: "x" }))).status).toBe(409);
    expect((await POST(req({ storeId: "a", receiptId: "v", op: "voidcash-reverse", reRingReceiptId: "rf" }))).status).toBe(409);
    state.set(R("f"), { status: "final", voidCashRetained: 50 });
    state.set(R("ok"), { status: "final" });
    expect((await POST(req({ storeId: "a", receiptId: "f", op: "voidcash-reverse", reRingReceiptId: "ok" }))).status).toBe(409);
    expect(retainedReversed).toBe(0);
  });

  it("accepts a genuine final re-ring once, and links it", async () => {
    state.set(R("v"), { ...voided });
    state.set(R("v2"), { ...voided });
    state.set(R("ok"), { status: "final", storeId: "a" });
    const res = await POST(req({ storeId: "a", receiptId: "v", op: "voidcash-reverse", reRingReceiptId: "ok" }));
    expect(res.status).toBe(200);
    expect(retainedReversed).toBe(50);
    expect(state.get(R("ok")).reRingOfReceiptId).toBe("v");
    // The same re-ring cannot also cancel another voided receipt's retained cash.
    const again = await POST(req({ storeId: "a", receiptId: "v2", op: "voidcash-reverse", reRingReceiptId: "ok" }));
    expect(again.status).toBe(409);
    expect(retainedReversed).toBe(50);
  });
});
