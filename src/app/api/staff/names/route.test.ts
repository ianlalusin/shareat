import { describe, it, expect, beforeEach, vi } from "vitest";

/** Audit B06: server name lookup that replaces client reads of `staff` docs. */

let lastRoles: string[] | undefined;
let accessImpl: () => Promise<any>;
const staff: Record<string, any> = {};

const db = {
  doc: (p: string) => ({ path: p, id: p.split("/").pop() }),
  getAll: async (...refs: any[]) =>
    refs.map((r) => ({ id: r.id, exists: r.id in staff, data: () => staff[r.id] })),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: "caller" }) }),
  getAdminDb: () => db,
}));
vi.mock("@/lib/server/staff-access", () => ({
  requireStaffStoreAccess: async (_db: any, _d: any, _storeId: string, roles: string[]) => {
    lastRoles = roles;
    return accessImpl();
  },
}));

import { POST } from "./route";

const req = (body: any) =>
  new Request("http://localhost/api/staff/names", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  for (const k of Object.keys(staff)) delete staff[k];
  Object.assign(staff, {
    u1: { name: "Ana", role: "cashier", assignedStoreIds: ["a"], email: "ana@x", pinHash: "secret", phone: "0917" },
    u2: { displayName: "Ben", role: "server", assignedStoreIds: ["b"] },
    u3: { username: "boss", role: "admin", assignedStoreIds: [] },
    u4: { name: "Old", role: "kitchen", status: "inactive", assignedStoreIds: ["a"] },
  });
  lastRoles = undefined;
  accessImpl = async () => ({ uid: "caller", role: "server" });
});

describe("POST /api/staff/names (B06)", () => {
  it("returns only names, only for this store's staff and admins", async () => {
    const res = await POST(req({ storeId: "a", uids: ["u1", "u2", "u3", "u4", "missing"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.names).toEqual({ u1: "Ana", u3: "boss", u4: "Old" });
    expect(JSON.stringify(body)).not.toMatch(/secret|ana@x|0917|cashier/);
  });

  it("any active staffer of the store may ask; others are refused", async () => {
    await POST(req({ storeId: "a", uids: ["u1"] }));
    expect(lastRoles).toEqual(["admin", "manager", "cashier", "kitchen", "server"]);
    accessImpl = async () => { throw new Error("No access to this store."); };
    const res = await POST(req({ storeId: "b", uids: ["u2"] }));
    expect(res.status).toBe(403);
  });

  it("validates input", async () => {
    expect((await POST(req({ uids: ["u1"] }))).status).toBe(400);
    expect((await POST(req({ storeId: "a", uids: Array.from({ length: 101 }, (_, i) => `x${i}`) }))).status).toBe(400);
    const res = await POST(req({ storeId: "a", uids: ["../stores/a"] }));
    expect((await res.json()).names).toEqual({});
  });
});
