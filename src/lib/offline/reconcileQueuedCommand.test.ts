import { describe, it, expect, vi } from "vitest";
import { reconcileQueuedCommand } from "./reconcileQueuedCommand";
import type { QueuedPayment } from "./payment-queue";

const item = (over: Partial<QueuedPayment> = {}): QueuedPayment => ({
  id: "q1", storeId: "s1", sessionId: "sA", receiptId: "sA", queuedAtMs: 1, status: "pending", kind: "payment",
  receiptNumber: "S1-OL-X-0320-001", opId: "op1", command: { schema: 1, opId: "op1" },
  ctx: { amount: 100 },
  effects: { analytics: "skip", loyaltyFinalize: "skip", loyaltyEarn: "skip", pinFinalize: "skip", loyaltyReverse: "skip" },
  ...over,
});
const respond = (status: number, body: any) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as any;
const deps = (fetchImpl: any, onRejected = vi.fn()) => ({ getToken: async () => "t", fetchImpl, onRejected });

describe("reconcileQueuedCommand (audit P1 / B16)", () => {
  it("sends the queued command copy and completes on acceptance", async () => {
    const f = respond(200, { ok: true, status: "accepted" });
    await expect(reconcileQueuedCommand(item(), deps(f))).resolves.toMatchObject({ complete: true });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toEqual({ storeId: "s1", opId: "op1", command: { schema: 1, opId: "op1" }, action: "apply" });
  });

  it("a server rejection throws (item -> failed, visible) and flags it for an explicit retry", async () => {
    const onRejected = vi.fn();
    await expect(reconcileQueuedCommand(item(), deps(respond(200, { ok: true, status: "rejected", code: "already_settled", message: "paid elsewhere" }), onRejected)))
      .rejects.toThrow(/paid elsewhere/);
    expect(onRejected).toHaveBeenCalled();
    const f = respond(200, { ok: true, status: "accepted" });
    await reconcileQueuedCommand(item({ rejected: true }), deps(f));
    expect(JSON.parse(f.mock.calls[0][1].body).action).toBe("retry");
  });

  it("network failure, 5xx and missing auth stay pending (never finalized, never failed)", async () => {
    const boom = vi.fn(async () => { throw new TypeError("offline"); }) as any;
    await expect(reconcileQueuedCommand(item(), deps(boom))).resolves.toMatchObject({ complete: false });
    await expect(reconcileQueuedCommand(item(), deps(respond(503, { ok: false })))).resolves.toMatchObject({ complete: false });
    await expect(reconcileQueuedCommand(item(), { getToken: async () => { throw new Error("no auth"); }, fetchImpl: respond(200, {}) }))
      .resolves.toMatchObject({ complete: false });
  });
});
