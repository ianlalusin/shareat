import { beforeEach, describe, expect, it, vi } from "vitest";

// Audit P1 hardening: the PIN to archive comes from client-writable session
// data, so finalizePinCore must only retire a registry entry that belongs to
// THIS store and session.
vi.mock("server-only", () => ({}));
vi.mock("firebase-admin/firestore", async () => (await import("./analytics/testing/fakeFirestore")).firestoreModule);
let db: any;
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => db, getAdminAuth: () => ({}) }));
vi.mock("@/lib/server/customer-participants", () => ({ endAllParticipants: async () => ({ revoked: 0, authDeleted: 0 }) }));
vi.mock("@/lib/server/write-activity-log", () => ({ writeServerActivityLog: async () => {} }));

import { FakeFirestore } from "./analytics/testing/fakeFirestore";
import { finalizePinCore } from "./finalize-pin";

beforeEach(() => {
  db = new FakeFirestore();
  db.seed("pinRegistry/111111", { status: "active", storeId: "A", sessionId: "s_other" });
  db.seed("pinRegistry/222222", { status: "active", storeId: "A", sessionId: "s1" });
  db.seed("stores/A/activeSessions/s1", { customerPin: "111111", customerAccessEnabled: true });
});

describe("finalizePinCore store/session check", () => {
  it("does not archive another bill's PIN copied into this session", async () => {
    await finalizePinCore({ storeId: "A", sessionId: "s1", pin: "111111", reason: "payment_closed", actorUid: "u" });
    expect(db.data("pinRegistry/111111").status).toBe("active");
    expect(db.data("stores/A/activeSessions/s1").customerAccessEnabled).toBe(false);
  });

  it("archives this bill's own PIN", async () => {
    await finalizePinCore({ storeId: "A", sessionId: "s1", pin: "222222", reason: "payment_closed", actorUid: "u" });
    expect(db.data("pinRegistry/222222").status).toBe("archived");
  });
});
