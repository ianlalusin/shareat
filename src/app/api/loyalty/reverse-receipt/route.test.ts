import { describe, it, expect, beforeEach, vi } from "vitest";

let lastRoles: string[] | undefined;
let accessImpl: () => Promise<any>;
const reverseMock = vi.fn();

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
vi.mock("@/lib/server/loyalty", () => ({ reverseLoyaltyForReceipt: (...a: any[]) => reverseMock(...a) }));

import { POST } from "./route";

const req = (body: any) =>
  new Request("http://localhost/api/loyalty/reverse-receipt", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  lastRoles = undefined;
  reverseMock.mockReset();
  reverseMock.mockResolvedValue({ ok: true, earn: { ok: true, reversed: 15, shortfall: 0 }, vouchers: { reversed: [], failed: [], deferred: false } });
  accessImpl = async () => ({ uid: "u1", role: "manager" });
});

describe("POST /api/loyalty/reverse-receipt (B07)", () => {
  it("validates reason and refund receipt", async () => {
    expect((await POST(req({ storeId: "a", receiptId: "r", reason: "removed" }))).status).toBe(400);
    expect((await POST(req({ storeId: "a", receiptId: "r", reason: "refund" }))).status).toBe(400);
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it("is a manager action; cashiers are refused", async () => {
    accessImpl = async () => { throw new Error("You are not allowed to access this route."); };
    const res = await POST(req({ storeId: "a", receiptId: "r", reason: "receipt_void" }));
    expect(res.status).toBe(403);
    expect(lastRoles).toEqual(["admin", "manager"]);
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it("passes the caller uid and reports points/vouchers", async () => {
    const res = await POST(req({ storeId: "a", receiptId: "r", reason: "refund", refundReceiptId: "rf" }));
    expect(res.status).toBe(200);
    expect(reverseMock.mock.calls[0][0]).toEqual({ storeId: "a", receiptId: "r", reason: "refund", refundReceiptId: "rf", staffUid: "u1" });
    expect(await res.json()).toMatchObject({ ok: true, points: { reversed: 15, shortfall: 0 } });
  });

  it("surfaces a refused reversal with its status", async () => {
    reverseMock.mockResolvedValue({ ok: false, error: "Receipt is not voided", status: 409, earn: { ok: false }, vouchers: { reversed: [], failed: [], deferred: false } });
    const res = await POST(req({ storeId: "a", receiptId: "r", reason: "receipt_void" }));
    expect(res.status).toBe(409);
  });
});
