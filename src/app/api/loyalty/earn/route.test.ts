import { describe, it, expect, beforeEach, vi } from "vitest";

let lastRoles: string[] | undefined;
let accessImpl: () => Promise<any>;
const earnMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: "u1" }) }),
  getAdminDb: () => ({}),
}));
vi.mock("@/lib/server/staff-access", () => ({
  requireStaffStoreAccess: async (_db: any, _d: any, _storeId: string, roles: string[]) => {
    lastRoles = roles;
    return accessImpl();
  },
}));
vi.mock("@/lib/server/loyalty", () => ({ writeLoyaltyEarn: (...a: any[]) => earnMock(...a) }));

import { POST } from "./route";

function req(body: any) {
  return new Request("http://localhost/api/loyalty/earn", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  lastRoles = undefined;
  earnMock.mockReset();
  earnMock.mockResolvedValue({ ok: true, points: 5 });
  accessImpl = async () => ({ uid: "u1", role: "cashier" });
});

describe("POST /api/loyalty/earn (B07)", () => {
  it("requires a receiptId", async () => {
    const res = await POST(req({ storeId: "a", sessionId: "s", phone: "p", amount: 100 }));
    expect(res.status).toBe(400);
    expect(earnMock).not.toHaveBeenCalled();
  });

  it("only checkout roles may earn; kitchen/server are refused", async () => {
    accessImpl = async () => { throw new Error("You are not allowed to access this route."); };
    const res = await POST(req({ storeId: "a", receiptId: "s" }));
    expect(res.status).toBe(403);
    expect(lastRoles).toEqual(["admin", "manager", "cashier"]);
    expect(earnMock).not.toHaveBeenCalled();
  });

  it("never forwards the client amount", async () => {
    const res = await POST(req({ storeId: "a", sessionId: "s", phone: "p", amount: 999999, receiptId: "s" }));
    expect(res.status).toBe(200);
    const args = earnMock.mock.calls[0][0];
    expect(args).toMatchObject({ storeId: "a", receiptId: "s", sessionId: "s", phone: "p", staffUid: "u1" });
    expect(args).not.toHaveProperty("amount");
  });
});
