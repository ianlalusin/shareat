import { describe, it, expect, beforeEach, vi } from "vitest";

let lastRoles: string[] | undefined;
let accessImpl: (storeId: string, roles: string[]) => Promise<any>;
const docs = new Map<string, any>();
const reads: string[] = [];

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: "cashier_1" }) }),
  getAdminDb: () => ({
    doc: (path: string) => ({
      get: async () => {
        reads.push(path);
        const data = docs.get(path);
        return { exists: data !== undefined, data: () => data };
      },
    }),
  }),
}));
vi.mock("@/lib/server/staff-access", () => ({
  requireStaffStoreAccess: async (_db: any, _d: any, storeId: string, roles: string[]) => {
    lastRoles = roles;
    return accessImpl(storeId, roles);
  },
}));

import { GET } from "./route";

const PHONE = "+639171234567";
const get = (qs: string, auth: string | null = "Bearer t") =>
  new Request(`http://localhost/api/loyalty/visit-count?${qs}`, {
    headers: auth ? { Authorization: auth } : {},
  });

beforeEach(() => {
  docs.clear();
  reads.length = 0;
  lastRoles = undefined;
  accessImpl = async () => ({ uid: "cashier_1", role: "cashier", assignedStoreIds: ["storeA"], isPlatformAdmin: false });
  docs.set("stores/storeA/onlineOrders/o1", { contact: { phone: "09171234567" } });
  docs.set(`customers/${PHONE}`, { visitCount: 7, passwordHash: "$2a$secret", name: "Juana", pointsBalance: 99 });
});

describe("GET /api/loyalty/visit-count", () => {
  it("401 without bearer token", async () => {
    expect((await GET(get("storeId=storeA&orderId=o1", null))).status).toBe(401);
  });

  it("400 without storeId or orderId", async () => {
    expect((await GET(get("orderId=o1"))).status).toBe(400);
    expect((await GET(get("storeId=storeA"))).status).toBe(400);
  });

  it("403 for staff not assigned to the store; reads nothing", async () => {
    accessImpl = async () => { throw new Error("No access to this store."); };
    expect((await GET(get("storeId=storeB&orderId=o1"))).status).toBe(403);
    expect(lastRoles).toEqual(["admin", "manager", "cashier"]);
    expect(reads).toEqual([]);
  });

  it("returns ONLY visitCount, never passwordHash or other PII", async () => {
    const res = await GET(get("storeId=storeA&orderId=o1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, visitCount: 7 });
  });

  it("takes the phone from the store's own order, so other stores' orders 404", async () => {
    // o1 exists only under storeA; a storeB caller cannot reach it.
    expect((await GET(get("storeId=storeB&orderId=o1"))).status).toBe(404);
    expect(reads).not.toContain(`customers/${PHONE}`);
  });

  it("null when the order's phone has no loyalty record", async () => {
    docs.delete(`customers/${PHONE}`);
    const res = await GET(get("storeId=storeA&orderId=o1"));
    expect(await res.json()).toEqual({ ok: true, visitCount: null });
  });

  it("404 when the order has no valid phone", async () => {
    docs.set("stores/storeA/onlineOrders/o1", { contact: { phone: "" } });
    expect((await GET(get("storeId=storeA&orderId=o1"))).status).toBe(404);
  });

  it("rejects path-injection in ids", async () => {
    expect((await GET(get("storeId=storeA&orderId=a/b"))).status).toBe(400);
  });
});
