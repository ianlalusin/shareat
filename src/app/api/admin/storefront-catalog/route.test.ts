import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for the storefront-catalog admin op endpoint.
 *
 * Focus: the boolean semantics of `set-config`. `stores/{id}/storefrontConfig/main`
 * is read as opt-OUT everywhere it is consumed — `cfg.deliveryEnabled !== false`
 * in Shareat Website functions/index.js:1541, in DeliveryPricingSettings.tsx and
 * in OnlineOrdersClient.tsx — so an ABSENT field means ENABLED. `set-config`
 * rebuilds the whole config document from the request body rather than patching
 * it, so it must default an omitted boolean the same way; `!!` here was the
 * opt-IN reading, and any future caller that omitted the field would have
 * silently paused delivery for the branch. Same bug class as the original
 * delivery-picker bug.
 *
 * Harness mirrors src/app/api/admin/online-orders/route.test.ts: an in-memory
 * Firestore double, FieldValue mocked to a recognisable sentinel, so assertions
 * read the write payload directly.
 */

const ACTOR_UID = "staff_uid_1";
const STORE = "L5MExycvUOfQ96Y10FqF"; // SharEat Lipa (NEXT_PUBLIC_STOREFRONT_STORE_ID)
const CONFIG_PATH = `stores/${STORE}/storefrontConfig/main`;

// --- module mocks ----------------------------------------------------------

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => ({ __sentinel: "serverTimestamp" }) },
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: ACTOR_UID }) }),
  getAdminDb: () => harness.db,
}));

vi.mock("@/lib/server/active-staff-check", () => ({
  requireActiveStaff: async () => ({
    isPlatformAdmin: false,
    assignedStoreIds: [STORE],
    role: mockStaffRole,
  }),
}));

vi.mock("@/lib/server/storefront-catalog", () => ({
  rebuildStorefrontCatalog: vi.fn(async () => ({ itemCount: 0 })),
}));

import { POST } from "./route";

// --- in-memory firestore double --------------------------------------------

type SetOp = { path: string; data: any; options: any };

function makeHarness(docs: Record<string, any>) {
  const sets: SetOp[] = [];
  const db = {
    doc: (path: string) => ({
      path,
      get: async () => ({ exists: docs[path] !== undefined, data: () => docs[path] }),
      set: async (data: any, options?: any) => {
        sets.push({ path, data, options });
        docs[path] = { ...(docs[path] ?? {}), ...data };
      },
    }),
  };
  return { db, docs, sets };
}

let harness: ReturnType<typeof makeHarness>;
let mockStaffRole: string;

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/admin/storefront-catalog", {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function configWrite(): any {
  const found = harness.sets.filter((s) => s.path === CONFIG_PATH);
  return found.length ? found[found.length - 1].data : null;
}

beforeEach(() => {
  mockStaffRole = "manager";
  harness = makeHarness({ [`stores/${STORE}`]: { name: "SharEat Lipa" } });
});

describe("set-config boolean semantics", () => {
  it("writes deliveryEnabled: true when the caller sends true", async () => {
    const res = await post({
      op: "set-config",
      storeId: STORE,
      config: { pickupEnabled: true, deliveryEnabled: true, deliveryFee: 50 },
    });
    expect(res.status).toBe(200);
    expect(configWrite().deliveryEnabled).toBe(true);
  });

  it("writes deliveryEnabled: false when the caller explicitly sends false", async () => {
    await post({
      op: "set-config",
      storeId: STORE,
      config: { pickupEnabled: true, deliveryEnabled: false },
    });
    expect(configWrite().deliveryEnabled).toBe(false);
  });

  // The regression this file exists for. Fails against `!!c.deliveryEnabled`.
  it("defaults an OMITTED deliveryEnabled to true (opt-out, matching every reader)", async () => {
    await post({
      op: "set-config",
      storeId: STORE,
      config: { deliveryFee: 50, minOrder: 200 },
    });
    expect(configWrite().deliveryEnabled).toBe(true);
  });

  it("defaults an omitted pickupEnabled to true too (unchanged sibling, pins the convention)", async () => {
    await post({ op: "set-config", storeId: STORE, config: { deliveryFee: 50 } });
    expect(configWrite().pickupEnabled).toBe(true);
  });

  it("still clamps the numeric fields and caps serviceAreaNote", async () => {
    await post({
      op: "set-config",
      storeId: STORE,
      config: { deliveryFee: -5, minOrder: "200", prepEtaMinutes: 15, serviceAreaNote: "x".repeat(400) },
    });
    const w = configWrite();
    expect(w.deliveryFee).toBe(0);
    expect(w.minOrder).toBe(200);
    expect(w.prepEtaMinutes).toBe(15);
    expect(w.serviceAreaNote).toHaveLength(300);
    expect(w.currency).toBe("PHP");
  });

  it("rejects a cashier (pricing config stays manager-and-up)", async () => {
    mockStaffRole = "cashier";
    const res = await post({
      op: "set-config",
      storeId: STORE,
      config: { deliveryEnabled: true },
    });
    expect(res.status).toBe(403);
  });
});

describe("set-delivery-enabled (deliberately NOT changed by this fix)", () => {
  it("writes exactly the boolean it is given, and merges only that one field", async () => {
    mockStaffRole = "cashier";
    const res = await post({ op: "set-delivery-enabled", storeId: STORE, deliveryEnabled: false });
    expect(res.status).toBe(200);
    const w = configWrite();
    expect(w.deliveryEnabled).toBe(false);
    expect(Object.keys(w).sort()).toEqual(["deliveryEnabled", "updatedAt"]);
  });
});
