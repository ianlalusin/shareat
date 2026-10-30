import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSnapshots, querySnap } from "@/test-utils/fakeSnapshots";

/**
 * F11: the add-ons subscription. Renders StoreContextProvider through the
 * hook harness (no DOM) and reads the context value off the returned
 * <Provider value=…> element.
 */

const fake = vi.hoisted(() => ({ impl: null as any, appUser: null as any }));

vi.mock("react", async () => (await import("@/test-utils/hookHarness")).reactMock);
vi.mock("@/lib/firebase/client", () => ({ db: {} }));
vi.mock("@/context/auth-context", () => ({ useAuthContext: () => ({ appUser: fake.appUser }) }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  query: (base: any, ...constraints: any[]) => ({ ...base, constraints }),
  where: (field: any, op: string, value: any) => ({ field, op, value }),
  documentId: () => "__name__",
  // Store list for a platform admin, and the (empty) product-photo join.
  getDocs: async (q: any) =>
    q.path === "stores"
      ? querySnap([{ id: "a", name: "A" }, { id: "b", name: "B" }])
      : querySnap([]),
  doc: vi.fn(),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  onSnapshot: (...a: any[]) => fake.impl.onSnapshot(...a),
}));

import { renderHook } from "@/test-utils/hookHarness";
import { StoreContextProvider } from "./store-context";

let snaps: ReturnType<typeof createFakeSnapshots>;
beforeEach(() => {
  snaps = createFakeSnapshots();
  fake.impl = snaps;
  fake.appUser = { uid: "u", isPlatformAdmin: true };
  (globalThis as any).localStorage = { getItem: () => "a", setItem: () => {} };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function mountProvider() {
  const h = renderHook(() => (StoreContextProvider as any)({ children: null }));
  const ctx = () => h.result.props.value;
  // let loadStoresOnce's getDocs resolve
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(ctx().activeStoreId).toBe("a");
  return { h, ctx };
}

const inventoryListeners = () => snaps.listeners.filter((l) => String(l.ref?.path).includes("/inventory"));
const activeInventory = () => inventoryListeners().filter((l) => l.active);

describe("StoreContextProvider add-ons (F11)", () => {
  it("repeated refresh keeps exactly one live listener", async () => {
    const { ctx } = await mountProvider();
    ctx().enableStoreAddons();
    expect(activeInventory()).toHaveLength(1);

    for (let i = 0; i < 5; i++) {
      // AddonsPOSModal passes it straight to onClick — called with an event.
      const ret = ctx().refreshStoreAddons({ type: "click" });
      expect(ret).toBeUndefined();
    }
    expect(inventoryListeners()).toHaveLength(6);
    expect(activeInventory()).toHaveLength(1);
  });

  it("an old-store callback after a store switch cannot replace the new store's add-ons", async () => {
    const { ctx } = await mountProvider();
    ctx().enableStoreAddons();
    const storeAListener = activeInventory()[0];
    storeAListener.next(querySnap([{ id: "a-addon", isAddon: true, isActive: true, price: 50, imageUrl: "x" }]));
    expect(ctx().storeAddons.map((r: any) => r.id)).toEqual(["a-addon"]);

    await ctx().setActiveStoreById("b");
    expect(ctx().activeStoreId).toBe("b");
    // Cleared immediately — store A's add-ons/prices are not shown under B.
    expect(ctx().storeAddons).toEqual([]);
    expect(storeAListener.active).toBe(false);
    expect(activeInventory()).toHaveLength(1);
    expect(activeInventory()[0].ref.path).toBe("stores/b/inventory");

    // A late store-A event (e.g. a refresh-era listener) is ignored.
    storeAListener.next(querySnap([{ id: "a-addon", isAddon: true, isActive: true, price: 999, imageUrl: "x" }]));
    expect(ctx().storeAddons).toEqual([]);

    activeInventory()[0].next(querySnap([{ id: "b-addon", isAddon: true, isActive: true, price: 60, imageUrl: "y" }]));
    expect(ctx().storeAddons.map((r: any) => r.id)).toEqual(["b-addon"]);
  });

  it("refresh before enable does not subscribe", async () => {
    const { ctx } = await mountProvider();
    ctx().refreshStoreAddons();
    expect(inventoryListeners()).toHaveLength(0);
  });
});
