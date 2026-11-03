import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Audit B22: the admin reset must write the server-owned revocation boundary
 * (staff/{uid}.tokensValidAfter, epoch seconds) that firestore.rules and
 * storage.rules compare against request.auth.token.auth_time. Without it a
 * pre-reset ID token keeps working against direct Firestore/Storage access
 * for up to an hour even though refresh tokens were revoked.
 */

const ADMIN_UID = "admin_1";
const TARGET_UID = "cashier_1";
const RESET_AT_MS = Date.UTC(2027, 0, 15, 8, 0, 0, 400); // .4s past the second

const calls: string[] = [];
const updates: Array<{ path: string; data: any }> = [];
let targetDoc: Record<string, any>;
let firebaseValidAfter: string | undefined;

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => ({ __sentinel: "serverTimestamp" }) },
}));

vi.mock("@/lib/server/active-staff-check", () => ({
  requireActiveStaff: async () => ({ uid: ADMIN_UID, role: "admin", displayName: "Admin", isPlatformAdmin: true }),
}));

vi.mock("@/lib/server/temp-password", () => ({ generateTempPassword: () => "TEMP-PASS" }));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async (_t: string, checkRevoked: boolean) => {
      calls.push(`verify:${checkRevoked}`);
      return { uid: ADMIN_UID };
    },
    getUser: async (uid: string) => {
      calls.push(`getUser:${uid}`);
      return {
        uid,
        email: "c@example.test",
        providerData: [{ providerId: "password" }],
        tokensValidAfterTime: firebaseValidAfter,
      };
    },
    updateUser: async () => {
      calls.push("updateUser");
    },
    revokeRefreshTokens: async () => {
      calls.push("revoke");
    },
  }),
  getAdminDb: () => ({
    doc: (path: string) => ({
      get: async () => ({ exists: true, data: () => targetDoc }),
      update: async (data: any) => {
        calls.push("update");
        updates.push({ path, data });
      },
    }),
  }),
}));

import { POST } from "./route";

function req() {
  return new Request("http://localhost/api/admin/users/reset-password", {
    method: "POST",
    headers: { authorization: "Bearer tok", "content-type": "application/json" },
    body: JSON.stringify({ uid: TARGET_UID }),
  });
}

beforeEach(() => {
  calls.length = 0;
  updates.length = 0;
  targetDoc = { role: "cashier", status: "active", name: "Ana" };
  firebaseValidAfter = new Date(Math.floor(RESET_AT_MS / 1000) * 1000).toUTCString();
  vi.useFakeTimers();
  vi.setSystemTime(RESET_AT_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/admin/users/reset-password — B22 revocation boundary", () => {
  it("verifies the caller with checkRevoked", async () => {
    await POST(req());
    expect(calls[0]).toBe("verify:true");
  });

  it("writes tokensValidAfter in epoch seconds, after revoking refresh tokens", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);

    expect(updates).toHaveLength(1);
    expect(updates[0].path).toBe(`staff/${TARGET_UID}`);
    expect(updates[0].data.tokensValidAfter).toBe(Math.floor(RESET_AT_MS / 1000));
    expect(updates[0].data.mustChangePassword).toBe(true);

    expect(calls.indexOf("revoke")).toBeGreaterThan(-1);
    expect(calls.indexOf("update")).toBeGreaterThan(calls.indexOf("revoke"));
  });

  it("uses Firebase's own tokensValidAfterTime when it is later than the server clock", async () => {
    const later = Math.floor(RESET_AT_MS / 1000) + 3;
    firebaseValidAfter = new Date(later * 1000).toUTCString();
    await POST(req());
    expect(updates[0].data.tokensValidAfter).toBe(later);
  });

  it("never lowers an existing, later boundary", async () => {
    const existing = Math.floor(RESET_AT_MS / 1000) + 600;
    targetDoc = { ...targetDoc, tokensValidAfter: existing };
    await POST(req());
    expect(updates[0].data.tokensValidAfter).toBe(existing);
  });

  it("still writes a boundary if Firebase omits tokensValidAfterTime", async () => {
    firebaseValidAfter = undefined;
    await POST(req());
    expect(updates[0].data.tokensValidAfter).toBe(Math.floor(RESET_AT_MS / 1000));
  });
});
