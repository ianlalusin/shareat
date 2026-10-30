import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSnapshots, querySnap } from "@/test-utils/fakeSnapshots";

/** F12 (open set vs history window) and F13 (confirmed-value rollback). */

const fake = vi.hoisted(() => ({ impl: null as any }));

vi.mock("react", async () => (await import("@/test-utils/hookHarness")).reactMock);
vi.mock("@/lib/firebase/client", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (_db: unknown, path: string) => ({ path }),
  query: (base: any, ...constraints: any[]) => ({ ...base, constraints }),
  where: (field: string, op: string, value: unknown) => ({ kind: "where", field, op, value }),
  orderBy: (field: string, dir: string) => ({ kind: "orderBy", field, dir }),
  limit: (n: number) => ({ kind: "limit", n }),
  onSnapshot: (...a: any[]) => fake.impl.onSnapshot(...a),
}));

import { renderHook } from "@/test-utils/hookHarness";
import {
  HISTORY_PAGE_SIZE,
  OPEN_ORDER_STATUSES,
  mergeOrderFeeds,
  useOnlineOrdersFeed,
} from "./useOnlineOrdersFeed";
import { useConfirmedRemoteValue } from "./useConfirmedRemoteValue";

let snaps: ReturnType<typeof createFakeSnapshots>;
beforeEach(() => {
  snaps = createFakeSnapshots();
  fake.impl = snaps;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const isOpenQuery = (l: any) => l.ref.constraints?.some((c: any) => c.kind === "where");
const isHistoryQuery = (l: any) => l.ref.constraints?.some((c: any) => c.kind === "limit");

describe("useOnlineOrdersFeed (F12)", () => {
  it("open query is unbounded and status-filtered; history is the windowed query", () => {
    renderHook(() => useOnlineOrdersFeed("a"));
    const open = snaps.listeners.find(isOpenQuery)!;
    const hist = snaps.listeners.find(isHistoryQuery)!;
    expect(open.ref.constraints).toEqual([
      { kind: "where", field: "status", op: "in", value: [...OPEN_ORDER_STATUSES] },
    ]);
    expect(open.ref.constraints.some((c: any) => c.kind === "limit")).toBe(false);
    expect(hist.ref.constraints).toContainEqual({ kind: "limit", n: HISTORY_PAGE_SIZE });
  });

  it("an open order older than 200 newer history orders is still listed and counted", () => {
    const h = renderHook(() => useOnlineOrdersFeed("a"));
    const open = snaps.listeners.find(isOpenQuery)!;
    const hist = snaps.listeners.find(isHistoryQuery)!;

    const oldPending = { id: "old-pending", status: "pending", createdAtClientMs: 1 };
    const oldPreparing = { id: "old-prep", status: "preparing", createdAtClientMs: 2 };
    // 200 newer terminal orders fill the whole history window.
    const newer = Array.from({ length: 200 }, (_, i) => ({
      id: `done-${i}`,
      status: i % 2 ? "completed" : "cancelled",
      createdAtClientMs: 1000 + i,
    }));
    hist.next(querySnap(newer));
    open.next(querySnap([oldPending, oldPreparing]));

    const ids = h.result.orders.map((o) => o.id);
    expect(ids).toContain("old-pending");
    expect(ids).toContain("old-prep");
    expect(h.result.orders.filter((o) => o.status === "pending")).toHaveLength(1);
    expect(h.result.isLoading).toBe(false);
    expect(h.result.historyHasMore).toBe(true);

    h.result.loadMoreHistory();
    expect(snaps.active().filter(isHistoryQuery)[0].ref.constraints).toContainEqual({ kind: "limit", n: 400 });
    // The open set listener is not churned by paging history.
    expect(snaps.listeners.filter(isOpenQuery)).toHaveLength(1);
  });

  it("merge: open statuses come only from the open set; terminal only from history", () => {
    const merged = mergeOrderFeeds(
      [{ id: "x", status: "accepted", createdAtClientMs: 5 }],
      [
        { id: "x", status: "pending", createdAtClientMs: 5 }, // stale history copy
        { id: "y", status: "pending", createdAtClientMs: 9 }, // no longer open per the open set
        { id: "z", status: "completed", createdAtClientMs: 7 },
      ]
    );
    expect(merged.map((o) => [o.id, o.status])).toEqual([
      ["z", "completed"],
      ["x", "accepted"],
    ]);
  });

  it("store switch drops the previous store's orders", () => {
    let storeId = "a";
    const h = renderHook(() => useOnlineOrdersFeed(storeId));
    snaps.listeners.find(isOpenQuery)!.next(querySnap([{ id: "a1", status: "pending" }]));
    storeId = "b";
    h.rerender();
    expect(h.result.orders).toEqual([]);
    expect(h.result.isLoading).toBe(true);
    snaps.listeners.filter(isOpenQuery)[0].next(querySnap([{ id: "a2", status: "pending" }]));
    expect(h.result.orders).toEqual([]);
  });

  it("open-set error ends loading and is exposed", () => {
    const onError = vi.fn();
    const h = renderHook(() => useOnlineOrdersFeed("a", onError));
    snaps.listeners.find(isOpenQuery)!.error!(new Error("denied"));
    expect(h.result.isLoading).toBe(false);
    expect(h.result.openError?.message).toBe("denied");
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "open");
  });
});

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("useConfirmedRemoteValue (F13)", () => {
  it("failed toggle rolls back to the last confirmed value with no snapshot", async () => {
    const h = renderHook(() => useConfirmedRemoteValue<boolean>("a", true));
    h.result.confirm("a", true);
    const d = deferred();
    const p = h.result.run(false, () => d.promise);
    expect(h.result.value).toBe(false); // optimistic
    expect(h.result.saving).toBe(true);
    d.reject(new Error("403 Forbidden"));
    const out = await p;
    expect(out.result).toBe("failed");
    expect(h.result.value).toBe(true); // back to confirmed
    expect(h.result.saving).toBe(false);
  });

  it("success makes the new value the confirmed one", async () => {
    const h = renderHook(() => useConfirmedRemoteValue<boolean>("a", true));
    h.result.confirm("a", true);
    expect((await h.result.run(false, async () => {})).result).toBe("ok");
    expect(h.result.value).toBe(false);
    expect(h.result.confirmedValue).toBe(false);
  });

  it("a response for a store you switched away from is ignored", async () => {
    let storeId = "a";
    const h = renderHook(() => useConfirmedRemoteValue<boolean>(storeId, true));
    h.result.confirm("a", true);
    const d = deferred();
    const p = h.result.run(false, () => d.promise);
    storeId = "b";
    h.rerender();
    h.result.confirm("b", true);
    expect(h.result.value).toBe(true); // store A's draft is not shown under B
    d.resolve();
    expect((await p).result).toBe("stale");
    expect(h.result.value).toBe(true);
    expect(h.result.saving).toBe(false);
  });

  it("snapshots for another store are ignored", () => {
    const h = renderHook(() => useConfirmedRemoteValue<boolean>("b", true));
    h.result.confirm("a", false);
    expect(h.result.value).toBe(true);
  });
});
