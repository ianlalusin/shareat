import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeFirestore, FakeTimestamp } from "./testing/fakeFirestore";

vi.mock("firebase-admin/firestore", async () => (await import("./testing/fakeFirestore")).firestoreModule);
vi.mock("@/lib/server/active-stores-cache", () => ({ getActiveStores: async () => [{ id: "s1" }] }));

import { rebuildDailyAnalyticsFromReceiptsServer, requestedDays } from "./backfillServer";
import { applyReceiptEvent } from "./receiptEventApplier";
import { getDayStartMs } from "@/lib/analytics/daily";

const DAY = "20260801";
const DAY_DOC = `stores/s1/analytics/${DAY}`;
const CLOSE_MS = Date.UTC(2026, 7, 1, 5, 0, 0); // 2026-08-01 13:00 PHT
const DAY_START = getDayStartMs(CLOSE_MS);

function receipt(total: number, minutesLater = 0, extra: Record<string, unknown> = {}) {
  const ms = CLOSE_MS + minutesLater * 60_000;
  return {
    storeId: "s1",
    sessionId: `sess${total}`,
    sessionMode: "alacarte",
    status: "final",
    createdAtClientMs: ms,
    createdAt: new FakeTimestamp(ms),
    lines: [],
    total,
    analytics: { v: 2, mop: { cash: total }, sessionStartedAtClientMs: ms - 60 * 60_000 },
    analyticsApplied: false,
    ...extra,
  };
}

function world() {
  const db = new FakeFirestore();
  db.seed("stores/s1", { name: "Store", taxType: "VAT_INCLUSIVE", taxRatePct: 12 });
  return db;
}

/** A checkout as the cashier does it: write the receipt, then the server delta. */
async function checkout(db: FakeFirestore, id: string, total: number, minutesLater: number) {
  db.seed(`stores/s1/receipts/${id}`, receipt(total, minutesLater));
  await applyReceiptEvent(db as any, "s1", id, "payment");
}

const rebuildDay = (db: FakeFirestore) =>
  rebuildDailyAnalyticsFromReceiptsServer(db as any, "s1", new Date(DAY_START), new Date(DAY_START));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CLOSE_MS + 6 * 60 * 60_000));
});
afterEach(() => vi.useRealTimers());

describe("B26: daily rebuild vs live deltas", () => {
  it("a checkout that lands mid-rebuild is not lost", async () => {
    const db = world();
    await checkout(db, "r1", 300, 0);

    let fired = false;
    db.afterQuery = async (path) => {
      // Fires right after the rebuild's receipt scan: a new sale is rung up and
      // its delta applied before the rebuild commits.
      if (fired || path !== "stores/s1/receipts") return;
      fired = true;
      await checkout(db, "r2", 500, 30);
    };

    const res = await rebuildDay(db);
    expect(fired).toBe(true);
    expect(res.attempts).toBe(2); // first commit refused, rescan picked up r2
    const day = db.data(DAY_DOC);
    expect(day.payments.totalGross).toBe(800);
    expect(day.payments.txCount).toBe(2);
    expect(day.meta.source).toBe("backfill_v6_server");
  });

  it("a receipt still pending at scan time is counted once, by its later apply", async () => {
    const db = world();
    await checkout(db, "r1", 300, 0);
    db.seed("stores/s1/receipts/r2", receipt(500, 30)); // payment call failed

    await rebuildDay(db);
    expect(db.data(DAY_DOC).payments.totalGross).toBe(300);

    await applyReceiptEvent(db as any, "s1", "r2", "payment"); // cron / retry
    expect(db.data(DAY_DOC).payments.totalGross).toBe(800);
    expect(db.data(DAY_DOC).payments.txCount).toBe(2);
  });

  it("a day with no receipts left is removed, not left stale", async () => {
    const db = world();
    db.seed(DAY_DOC, { meta: { dayId: DAY, dayStartMs: DAY_START }, payments: { totalGross: 999, txCount: 3 } });

    const res = await rebuildDay(db);
    expect(res.deleted).toBe(1);
    expect(db.data(DAY_DOC)).toBeUndefined();
  });

  it("a day whose last receipt was voided keeps only its retained cash and chat stats", async () => {
    const db = world();
    await checkout(db, "r1", 300, 0);
    db.seed("stores/s1/receipts/r1", {
      ...db.data("stores/s1/receipts/r1"),
      status: "voided",
      analyticsReversed: false,
      voidCashRetained: 120,
    });
    await applyReceiptEvent(db as any, "s1", "r1", "void");
    db.seed(DAY_DOC, { ...db.data(DAY_DOC), chat: { totalReceived: 4 } });
    const live = db.data(DAY_DOC);

    await rebuildDay(db);
    const day = db.data(DAY_DOC);
    expect(day.payments.totalGross ?? 0).toBe(0);
    expect(day.payments.txCount ?? 0).toBe(0);
    expect(day.payments.voidCashRetainedTotal).toBe(live.payments.voidCashRetainedTotal);
    expect(day.payments.voidCashRetainedTotal).toBe(120);
    expect(day.chat).toEqual({ totalReceived: 4 });
  });

  it("covers every requested day, including ones with no data", () => {
    const days = requestedDays(DAY_START, DAY_START + 3 * 86_400_000);
    expect(days.map((d) => d.dayId)).toEqual(["20260801", "20260802", "20260803"]);
  });

  it("gives up without overwriting when live writes never stop", async () => {
    const db = world();
    await checkout(db, "r1", 300, 0);
    let n = 0;
    db.afterQuery = async (path) => {
      if (path === "stores/s1/receipts") await checkout(db, `x${++n}`, 10, 40 + n);
    };
    await expect(rebuildDay(db)).rejects.toThrow(/colliding with live writes/);
    // Every live sale is still in the doc: 300 + 5 x 10.
    expect(db.data(DAY_DOC).payments.totalGross).toBe(350);
  });
});

describe("rebuild vs a receipt edit whose analytics delta is still pending", () => {
  const PATH = "stores/s1/receipts/r1";

  /**
   * Edit as the receipts screen saves it: the revision (snapshot = the receipt
   * before the edit) and the edited receipt are committed together; the
   * analytics delta is applied separately, afterwards (applyReceiptDeltaServerFirst).
   */
  function saveEditWithoutDelta(db: FakeFirestore, version: number, newTotal: number) {
    const before = db.data(PATH);
    db.seed(`${PATH}/revisions/v${version}`, { version, snapshot: before });
    db.seed(PATH, {
      ...before,
      editVersion: version,
      total: newTotal,
      analytics: { ...before.analytics, mop: { cash: newTotal } },
    });
  }

  it("rebuilding before the edit delta lands counts the last applied state, then the delta moves it once", async () => {
    const db = world();
    await checkout(db, "r1", 100, 0);
    saveEditWithoutDelta(db, 1, 80);

    await rebuildDay(db);
    // The day must still hold what the live projection had (100): the pending
    // edit delta (-20) is what takes it to 80.
    expect(db.data(DAY_DOC).payments.totalGross).toBe(100);

    await applyReceiptEvent(db as any, "s1", "r1", "edit", { revisionId: "v1" });
    expect(db.data(DAY_DOC).payments.totalGross).toBe(80);

    // Replaying the same edit event changes nothing.
    await applyReceiptEvent(db as any, "s1", "r1", "edit", { revisionId: "v1" });
    expect(db.data(DAY_DOC).payments.totalGross).toBe(80);
  });

  it("an edit whose delta was already applied is counted at its edited value", async () => {
    const db = world();
    await checkout(db, "r1", 100, 0);
    saveEditWithoutDelta(db, 1, 80);
    await applyReceiptEvent(db as any, "s1", "r1", "edit", { revisionId: "v1" });
    expect(db.data(DAY_DOC).payments.totalGross).toBe(80);

    await rebuildDay(db);
    expect(db.data(DAY_DOC).payments.totalGross).toBe(80);
  });

  it("with a second edit pending, the rebuild counts the state before the first pending edit", async () => {
    const db = world();
    await checkout(db, "r1", 100, 0);
    saveEditWithoutDelta(db, 1, 80);
    await applyReceiptEvent(db as any, "s1", "r1", "edit", { revisionId: "v1" });
    saveEditWithoutDelta(db, 2, 70); // v2 saved, its delta not applied

    await rebuildDay(db);
    expect(db.data(DAY_DOC).payments.totalGross).toBe(80); // last applied state

    await applyReceiptEvent(db as any, "s1", "r1", "edit", { revisionId: "v2" });
    expect(db.data(DAY_DOC).payments.totalGross).toBe(70);
  });

  it("other receipts on the day are unaffected by a pending edit", async () => {
    const db = world();
    await checkout(db, "r1", 100, 0);
    await checkout(db, "r2", 300, 30);
    saveEditWithoutDelta(db, 1, 80);

    await rebuildDay(db);
    expect(db.data(DAY_DOC).payments.totalGross).toBe(400);
    expect(db.data(DAY_DOC).payments.txCount).toBe(2);
  });
});
