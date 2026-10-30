import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSnapshots, docSnap } from "@/test-utils/fakeSnapshots";

/** F17: store config must never leak from a previous store. */

const fake = vi.hoisted(() => ({ impl: null as any }));

vi.mock("react", async () => (await import("@/test-utils/hookHarness")).reactMock);
vi.mock("@/lib/firebase/client", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => path.join("/"),
  onSnapshot: (...a: any[]) => fake.impl.onSnapshot(...a),
}));

import { renderHook } from "@/test-utils/hookHarness";
import { useStoreConfigDoc } from "./useStoreConfigDoc";

let snaps: ReturnType<typeof createFakeSnapshots>;
beforeEach(() => {
  snaps = createFakeSnapshots();
  fake.impl = snaps;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const configA = { modesOfPayment: [{ id: "a-cash" }], packages: [{ id: "a-pkg" }] };

describe("useStoreConfigDoc (F17)", () => {
  it("store switch then listener error: no store-A config, error exposed", () => {
    let storeId = "a";
    const h = renderHook(() => useStoreConfigDoc(storeId));
    snaps.listeners[0].next(docSnap("current", configA));
    expect(h.result.config?.modesOfPayment[0].id).toBe("a-cash");
    expect(h.result.configStoreId).toBe("a");

    storeId = "b";
    h.rerender();
    // Synchronously cleared on the very render that changed the store.
    expect(h.result.config).toBeNull();
    expect(h.result.isLoading).toBe(true);
    expect(snaps.listeners[0].active).toBe(false);

    snaps.listeners[1].error!(new Error("branch B denied"));
    expect(h.result.config).toBeNull();
    expect(h.result.isLoading).toBe(false);
    expect(h.result.error?.message).toBe("branch B denied");
    expect(h.result.configStoreId).toBeNull();
  });

  it("a late snapshot from store A's dead listener is ignored", () => {
    let storeId = "a";
    const h = renderHook(() => useStoreConfigDoc(storeId));
    storeId = "b";
    h.rerender();
    snaps.listeners[0].next(docSnap("current", configA));
    expect(h.result.config).toBeNull();
    expect(h.result.isLoading).toBe(true);
  });

  it("an error after a good snapshot drops the config; retry re-subscribes", () => {
    const h = renderHook(() => useStoreConfigDoc("a"));
    snaps.listeners[0].next(docSnap("current", configA));
    snaps.listeners[0].error!(new Error("permission-denied"));
    expect(h.result.config).toBeNull();
    expect(h.result.error).toBeTruthy();

    h.result.retry();
    expect(snaps.active()).toHaveLength(1);
    expect(snaps.listeners).toHaveLength(2);
    expect(h.result.isLoading).toBe(true);
    expect(h.result.error).toBeNull();
    snaps.listeners[1].next(docSnap("current", configA));
    expect((h.result.config?.packages[0] as any).id).toBe("a-pkg");
  });

  it("missing doc → null config, not loading, no error; no store → idle", () => {
    let storeId: string | null = "a";
    const h = renderHook(() => useStoreConfigDoc(storeId));
    snaps.listeners[0].next(docSnap("current"));
    expect(h.result).toMatchObject({ config: null, isLoading: false, error: null });
    storeId = null;
    h.rerender();
    expect(h.result).toMatchObject({ config: null, isLoading: false, error: null });
    expect(snaps.active()).toHaveLength(0);
  });
});
