import { describe, it, expect, beforeEach, vi } from "vitest";

let lastRoles: string[] | undefined;
let accessImpl: (storeId: string, roles: string[]) => Promise<any>;
const findMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: "cashier_1" }) }),
  getAdminDb: () => ({}),
}));
vi.mock("@/lib/server/staff-access", () => ({
  requireStaffStoreAccess: async (_db: any, _d: any, storeId: string, roles: string[]) => {
    lastRoles = roles;
    return accessImpl(storeId, roles);
  },
}));
vi.mock("@/lib/server/find-customer", () => ({ findCustomers: (...a: any[]) => findMock(...a) }));

import { GET } from "./route";

const get = (qs: string, auth: string | null = "Bearer t") =>
  new Request(`http://localhost/api/loyalty/find-customer?${qs}`, {
    headers: auth ? { Authorization: auth } : {},
  });

beforeEach(() => {
  lastRoles = undefined;
  findMock.mockReset();
  accessImpl = async () => ({ uid: "cashier_1", role: "cashier", assignedStoreIds: ["storeA"], isPlatformAdmin: false });
});

describe("GET /api/loyalty/find-customer", () => {
  it("401 without bearer token", async () => {
    expect((await GET(get("storeId=storeA&q=maria", null))).status).toBe(401);
  });
  it("400 without storeId", async () => {
    expect((await GET(get("q=maria"))).status).toBe(400);
  });
  it("kitchen/server style denial → 403, role list is admin/manager/cashier", async () => {
    accessImpl = async () => { throw new Error("You are not allowed to access this route."); };
    expect((await GET(get("storeId=storeA&q=maria"))).status).toBe(403);
    expect(lastRoles).toEqual(["admin", "manager", "cashier"]);
    expect(findMock).not.toHaveBeenCalled();
  });
  it("returns the finder result", async () => {
    findMock.mockResolvedValue({ kind: "name", results: [{ phone: "+639171234567", name: "Maria", pointsBalance: 5 }] });
    const res = await GET(get("storeId=storeA&q=maria"));
    expect(res.status).toBe(200);
    expect(findMock).toHaveBeenCalledWith(expect.anything(), { storeId: "storeA", q: "maria" });
    expect(await res.json()).toEqual({
      ok: true, kind: "name", results: [{ phone: "+639171234567", name: "Maria", pointsBalance: 5 }],
    });
  });
});
