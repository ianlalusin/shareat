import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit P1 follow-up: a payment conversion's actor name comes from the
 * verified local-profile session (x-pos-operator-session), never from the
 * client-sent actorName.
 */
vi.mock("firebase-admin/firestore", async () => (await import("@/lib/server/analytics/testing/fakeFirestore")).firestoreModule);

import { FakeFirestore } from "@/lib/server/analytics/testing/fakeFirestore";
import { issueProfileSession } from "@/lib/server/server-profile-session";

const S = "storeA";
let db: FakeFirestore;
let uid = "u_cashier";
const created: any[] = [];
const voided: any[] = [];

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => db,
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid }) }),
}));
vi.mock("@/lib/server/analytics/applyPaymentConversionServer", () => ({
  createPaymentConversionServer: async (_db: unknown, _s: string, _input: unknown, actor: unknown) => {
    created.push(actor);
    return "c1";
  },
  voidPaymentConversionServer: async (_db: unknown, _s: string, _id: string, actor: unknown) => {
    voided.push(actor);
    return { skipped: false };
  },
}));

import { POST } from "./route";

const req = (body: Record<string, unknown>, token?: string) =>
  new Request("http://x/api/analytics/payment-conversion", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t", ...(token ? { "x-pos-operator-session": token } : {}) },
    body: JSON.stringify({ storeId: S, ...body }),
  });

beforeEach(() => {
  process.env.SERVER_PROFILE_SESSION_SECRET = "test-secret";
  db = new FakeFirestore();
  uid = "u_cashier";
  created.length = 0;
  voided.length = 0;
  db.seed("staff/u_cashier", { role: "cashier", status: "active", assignedStoreIds: [S], name: "tablet" });
  db.seed("staff/u_manager", { role: "manager", status: "active", assignedStoreIds: [S], name: "Mgr" });
  db.seed(`stores/${S}/serverProfiles/p_ana`, { name: "Ana" });
});

const createBody = { action: "create", amount: 100, fromMethod: "Cash", toMethod: "GCash", actorName: "Forged Boss" };

describe("payment-conversion actor (audit P1)", () => {
  it("names the actor from the verified operator session, ignoring actorName", async () => {
    const token = issueProfileSession({ uid: "u_cashier", storeId: S, profileId: "p_ana" })!.token;
    const res = await POST(req(createBody, token));
    expect(res.status).toBe(200);
    expect(created[0]).toMatchObject({ uid: "u_cashier", name: "Ana", role: "cashier" });
  });

  it("refuses a cashier with no operator session", async () => {
    const res = await POST(req(createBody));
    expect(res.status).toBe(401);
    expect(created).toHaveLength(0);
  });

  it("a manager without a session is named from the account, not the body", async () => {
    uid = "u_manager";
    const res = await POST(req({ action: "void", conversionId: "c1", actorName: "Forged" }));
    expect(res.status).toBe(200);
    expect(voided[0]).toMatchObject({ uid: "u_manager", name: "Mgr" });
  });
});
