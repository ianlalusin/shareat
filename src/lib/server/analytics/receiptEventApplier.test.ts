import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeFirestore, FakeTimestamp } from "./testing/fakeFirestore";

vi.mock("firebase-admin/firestore", async () => (await import("./testing/fakeFirestore")).firestoreModule);

let current: FakeFirestore;
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => current,
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: "staff" }) }),
}));
vi.mock("@/lib/server/staff-access", () => ({ requireStaffStoreAccess: async () => ({ role: "cashier" }) }));
vi.mock("@/lib/server/active-stores-cache", () => ({ getActiveStores: async () => [{ id: "s1" }] }));

import { POST } from "@/app/api/analytics/apply-delta/route";
import { reconcileAnalyticsForStore } from "./reconcileAnalytics";

const CLOSE_MS = Date.UTC(2026, 7, 1, 5, 0, 0); // 2026-08-01 13:00 PHT
const RECEIPT = "stores/s1/receipts/r1";

function receipt(extra: Record<string, unknown> = {}) {
  return {
    storeId: "s1",
    sessionId: "sess1",
    receiptNumber: "OR-00001",
    sessionMode: "alacarte",
    status: "final",
    createdAtClientMs: CLOSE_MS,
    createdAt: new FakeTimestamp(CLOSE_MS),
    lines: [
      { id: "l1", type: "addon", itemId: "coke", itemName: "Coke", category: "Drinks", unitPrice: 100, qtyOrdered: 2, freeQty: 0, voidedQty: 0, discountQty: 0 },
    ],
    total: 200,
    analytics: { v: 2, mop: { cash: 200 }, sessionStartedAtClientMs: CLOSE_MS - 90 * 60_000 },
    analyticsApplied: false,
    ...extra,
  };
}

function world(extra: Record<string, unknown> = {}) {
  const db = new FakeFirestore();
  db.seed("stores/s1", { name: "Store", taxType: "VAT_INCLUSIVE", taxRatePct: 12 });
  db.seed(RECEIPT, receipt(extra));
  current = db;
  return db;
}

const call = (op: string) =>
  POST(
    new Request("http://localhost/api/analytics/apply-delta", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: "s1", receiptId: "r1", op }),
    }),
  );

/** The void flow's own commit: status voided + pending reversal flag. */
function markVoided(db: FakeFirestore, retained: number) {
  db.seed(RECEIPT, { ...db.data(RECEIPT), status: "voided", analyticsReversed: false, voidCashRetained: retained });
}

/** Everything except the receipt doc's bookkeeping timestamps. */
function projection(db: FakeFirestore) {
  const all = db.snapshot((p) => p === RECEIPT);
  const r = db.data(RECEIPT);
  all[RECEIPT] = { analyticsApplied: r.analyticsApplied, analyticsReversed: r.analyticsReversed };
  return all;
}

/** Numeric view: zero counters and empty maps are the same as "absent". */
function nonZero(v: any): any {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "meta" || k === "updatedAt") continue;
      const n = nonZero(x);
      if (n === undefined) continue;
      o[k] = n;
    }
    return Object.keys(o).length ? o : undefined;
  }
  return v === 0 ? undefined : v;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CLOSE_MS + 2 * 60 * 60_000));
});
afterEach(() => vi.useRealTimers());

describe("B23: reconcile cron and apply-delta share one applier", () => {
  it("payment: endpoint fails -> cron -> endpoint retry == endpoint first", async () => {
    const a = world();
    expect((await call("payment")).status).toBe(200);
    const endpointFirst = projection(a);

    const b = world(); // endpoint call never landed
    const swept = await reconcileAnalyticsForStore(b as any, "s1");
    expect(swept).toMatchObject({ applied: 1, reversed: 0, failed: 0 });
    const retry = await (await call("payment")).json();
    expect(retry.skipped).toBe(true);

    expect(projection(b)).toEqual(endpointFirst);
    // The effects the old cron skipped are really there.
    expect(b.data("stores/s1/catalogCache/popularItems").counts.coke).toBe(2);
    expect(b.data("stores/s1/dailySessions/20260801").rows.r1).toBeTruthy();
    expect(b.data("stores/s1/analytics/20260801").payments.totalGross).toBe(200);
  });

  it("void: endpoint fails -> cron -> endpoint retry == endpoint first", async () => {
    const a = world();
    await call("payment");
    markVoided(a, 150);
    expect((await call("void")).status).toBe(200);
    const endpointFirst = projection(a);

    const b = world();
    await call("payment");
    markVoided(b, 150); // void endpoint call never landed
    const swept = await reconcileAnalyticsForStore(b as any, "s1");
    expect(swept).toMatchObject({ applied: 0, reversed: 1, failed: 0 });
    const retry = await (await call("void")).json();
    expect(retry.skipped).toBe(true);

    expect(projection(b)).toEqual(endpointFirst);
    const day = b.data("stores/s1/analytics/20260801");
    expect(day.payments.voidCashRetainedTotal).toBe(150);
    expect(day.payments.totalGross).toBe(0);
    expect(b.data("stores/s1/dailySessions/20260801").rows.r1).toBeUndefined();
    expect(b.data("stores/s1/catalogCache/popularItems").counts.coke).toBe(0);
  });

  it("voided before its payment applied: cron nets the same as apply-then-void", async () => {
    const a = world();
    await call("payment");
    markVoided(a, 80);
    await call("void");

    const b = world();
    markVoided(b, 80); // both the payment and void calls were lost
    await reconcileAnalyticsForStore(b as any, "s1");
    expect((await (await call("payment")).json()).skipped).toBe(true);
    expect((await (await call("void")).json()).skipped).toBe(true);

    expect(nonZero(projection(b))).toEqual(nonZero(projection(a)));
    expect(b.data("stores/s1/analytics/20260801").payments.voidCashRetainedTotal).toBe(80);
  });

  it("cron skips (and reports) a pending reversal on a receipt that is not voided", async () => {
    const b = world({ analyticsApplied: true, analyticsReversed: false });
    const swept = await reconcileAnalyticsForStore(b as any, "s1");
    expect(swept).toMatchObject({ reversed: 0, failed: 1 });
    expect(b.data(RECEIPT).analyticsReversed).toBe(false);
  });
});
