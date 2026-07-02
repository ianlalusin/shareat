import { describe, it, expect, vi } from "vitest";
import { replayDeferredEffects } from "@/lib/offline/replayDeferredEffects";
import type { QueuedPayment } from "@/lib/offline/payment-queue";

function item(effects: Partial<QueuedPayment["effects"]> = {}): QueuedPayment {
  return {
    id: "q1", storeId: "s1", sessionId: "sess1", receiptId: "sess1", queuedAtMs: 0, status: "pending",
    ctx: { pin: "1234", phone: "0917", amount: 100 },
    effects: { analytics: "pending", loyaltyFinalize: "pending", loyaltyEarn: "pending", pinFinalize: "pending", loyaltyReverse: "skip", ...effects },
  };
}
const ok = () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
const fail = () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response);

describe("replayDeferredEffects", () => {
  it("marks all effects done and reports complete when every call succeeds", async () => {
    const fetchImpl = vi.fn(ok) as unknown as typeof fetch;
    const { item: out, complete } = await replayDeferredEffects(item(), { getToken: async () => "tok", fetchImpl });
    expect(complete).toBe(true);
    expect(out.effects).toEqual({ analytics: "done", loyaltyFinalize: "done", loyaltyEarn: "done", pinFinalize: "done", loyaltyReverse: "skip" });
    // one call per pending effect (loyaltyReverse is skip for payment items)
    expect((fetchImpl as any).mock.calls.length).toBe(4);
  });

  it("leaves a failed effect pending and reports not complete", async () => {
    // analytics ok, loyaltyFinalize fails, others ok
    const fetchImpl = vi.fn((url: string) =>
      String(url).includes("/loyalty/finalize") ? fail() : ok(),
    ) as unknown as typeof fetch;
    const { item: out, complete } = await replayDeferredEffects(item(), { getToken: async () => "tok", fetchImpl });
    expect(complete).toBe(false);
    expect(out.effects.loyaltyFinalize).toBe("pending");
    expect(out.effects.analytics).toBe("done");
  });

  it("does not call endpoints for effects already done/skip", async () => {
    const fetchImpl = vi.fn(ok) as unknown as typeof fetch;
    const out = await replayDeferredEffects(
      item({ analytics: "done", loyaltyEarn: "skip", loyaltyFinalize: "done", pinFinalize: "pending" }),
      { getToken: async () => "tok", fetchImpl },
    );
    expect((fetchImpl as any).mock.calls.length).toBe(1); // only pinFinalize
    expect(out.complete).toBe(true);
  });

  it("includes the bearer token and correct body for loyalty earn", async () => {
    const fetchImpl = vi.fn(ok) as unknown as typeof fetch;
    await replayDeferredEffects(item({ analytics: "skip", loyaltyFinalize: "skip", pinFinalize: "skip" }), { getToken: async () => "tok", fetchImpl });
    const call = (fetchImpl as any).mock.calls.find((c: any[]) => String(c[0]).includes("/loyalty/earn"));
    expect(call).toBeTruthy();
    expect(call[1].headers.Authorization).toBe("Bearer tok");
    const body = JSON.parse(call[1].body);
    expect(body).toMatchObject({ storeId: "s1", sessionId: "sess1", phone: "0917", amount: 100, receiptId: "sess1" });
  });

  it("calls onEffectDone after each successful effect (incremental persistence)", async () => {
    const doneCounts: number[] = [];
    const fetchImpl = vi.fn(ok) as unknown as typeof fetch;
    await replayDeferredEffects(item(), {
      getToken: async () => "tok",
      fetchImpl,
      onEffectDone: (it) => doneCounts.push(Object.values(it.effects).filter((v) => v === "done").length),
    });
    expect(doneCounts).toEqual([1, 2, 3, 4]); // one more effect done each call
  });

  it("returns not-complete and does not fetch when getToken throws (transient)", async () => {
    const fetchImpl = vi.fn(ok) as unknown as typeof fetch;
    const { complete } = await replayDeferredEffects(item(), {
      getToken: async () => { throw new Error("no token"); },
      fetchImpl,
    });
    expect(complete).toBe(false);
    expect((fetchImpl as any).mock.calls.length).toBe(0);
  });
});
