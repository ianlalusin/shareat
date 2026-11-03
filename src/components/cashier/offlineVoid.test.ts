import { describe, it, expect, beforeEach, vi } from "vitest";

// Offline void after audit P1 / B17: the queue item is saved BEFORE anything
// else (the old dialog awaited the void batch first, so a crash or quota error
// lost the deferred PIN / loyalty marker), and nothing canonical is written.
const state = new Map<string, any>();
const calls: string[] = [];

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  getDoc: async (ref: any) => ({ exists: () => state.has(ref.path), data: () => state.get(ref.path) }),
  setDoc: async (ref: any) => { calls.push(`setDoc:${ref.path}`); },
}));
vi.mock("@/lib/firebase/client", () => ({ db: {}, auth: {} }));
vi.mock("@/lib/offline/browserDevice", () => ({ getBrowserDeviceId: () => "dev" }));
vi.mock("@/lib/pos-commands/client", () => ({ getOperatorSessionToken: () => "tok" }));
const addToQueue = vi.fn((item: any) => { calls.push("queue"); return { ...item, id: "q" }; });
vi.mock("@/lib/offline/payment-queue", () => ({ addToQueue: (i: any) => addToQueue(i) }));
vi.mock("@/components/cashier/activity-log", () => ({ writeActivityLog: async () => { calls.push("log"); } }));
vi.mock("@/components/cashier/firestore", () => ({}));
vi.mock("@/context/auth-context", () => ({}));

import { voidSessionOffline } from "./offlineVoid";

beforeEach(() => {
  state.clear();
  calls.length = 0;
  addToQueue.mockClear();
  state.set("stores/s1/sessions/sA", { status: "active", tableId: "t1", revision: 2, billingRevision: 4, loyaltyRedemptions: [{ redemptionId: "r1" }] });
  state.set("stores/s1/activeSessions/sA", { customerPin: "999000" });
});

describe("voidSessionOffline (audit P1 / B17)", () => {
  it("queues first, then the create-only command; no canonical writes", async () => {
    const r = await voidSessionOffline({ storeId: "s1", sessionId: "sA", reason: "walkout", actor: { uid: "u1" } as any });
    expect(r.queued).toBe(true);
    expect(calls.slice(0, 2)).toEqual(["queue", `setDoc:stores/s1/posCommands/${r.opId}`]);
    expect(calls.filter((c) => c.startsWith("setDoc:")).length).toBe(1);
    expect(addToQueue.mock.calls[0][0].command).toMatchObject({
      kind: "voidSession", expected: { sessionRevision: 2, tableId: "t1" }, payload: { reason: "walkout" }, operatorSessionToken: "tok",
    });
  });

  it("a failed queue save means the void is not taken", async () => {
    addToQueue.mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });
    await expect(voidSessionOffline({ storeId: "s1", sessionId: "sA", reason: "x", actor: { uid: "u1" } as any })).rejects.toThrow();
    expect(calls.some((c) => c.startsWith("setDoc:"))).toBe(false);
  });
});
