import { describe, it, expect, beforeEach, vi } from "vitest";

let lastRoles: string[] | undefined;
let accessImpl: (storeId: string, roles: string[]) => Promise<any>;
const linkMock = vi.fn();

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
vi.mock("@/lib/server/session-link", () => ({ linkCardToSession: (...a: any[]) => linkMock(...a) }));

import { POST } from "./route";

function req(body: any, auth: string | null = "Bearer t") {
  return new Request("http://localhost/api/loyalty/link-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}
const good = { storeId: "storeA", sessionId: "s1", phone: "0917 123 4567" };

beforeEach(() => {
  lastRoles = undefined;
  linkMock.mockReset();
  accessImpl = async () => ({ uid: "cashier_1", role: "cashier", assignedStoreIds: ["storeA"], isPlatformAdmin: false });
});

describe("POST /api/loyalty/link-session", () => {
  it("401 without bearer token", async () => {
    expect((await POST(req(good, null))).status).toBe(401);
  });
  it("400 on missing ids or invalid phone", async () => {
    expect((await POST(req({ ...good, sessionId: "" }))).status).toBe(400);
    expect((await POST(req({ ...good, phone: "0917" }))).status).toBe(400);
    expect(linkMock).not.toHaveBeenCalled();
  });
  it("only admin/manager/cashier are accepted; denial → 403 and no write", async () => {
    accessImpl = async () => { throw new Error("You are not allowed to access this route."); };
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect(lastRoles).toEqual(["admin", "manager", "cashier"]);
    expect(linkMock).not.toHaveBeenCalled();
  });
  it("passes the normalized phone and staff uid to the core and returns its result", async () => {
    linkMock.mockResolvedValue({ ok: true, phone: "+639171234567", name: "Maria", pointsBalance: 5, alreadyLinked: false });
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(linkMock).toHaveBeenCalledWith(expect.anything(), {
      storeId: "storeA", sessionId: "s1", phone: "+639171234567", staffUid: "cashier_1",
    });
    expect(await res.json()).toEqual({ ok: true, phone: "+639171234567", name: "Maria", pointsBalance: 5, alreadyLinked: false });
  });
  it("maps core failures to their status", async () => {
    linkMock.mockResolvedValue({ ok: false, status: 409, error: "Session already linked to Jose." });
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "Session already linked to Jose." });
  });
});
