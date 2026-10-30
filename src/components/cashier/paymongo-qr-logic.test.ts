import { describe, expect, it } from "vitest";
import {
  checkQrStatus,
  expiryVerdict,
  serverClockOffsetMs,
  shouldListenForPayment,
} from "./paymongo-qr-logic";

const body = { storeId: "a", sessionId: "s", intentDocId: "i" };
const reply = (status: number, json: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => json });

describe("F06 listener survives local expiry; expiry checks before claiming no payment", () => {
  it("listener stays on for an unresolved intent regardless of the countdown (probe F06)", () => {
    expect(shouldListenForPayment("i", false)).toBe(true);
    expect(shouldListenForPayment("i", true)).toBe(false);
    expect(shouldListenForPayment(null, false)).toBe(false);
  });

  it("expired screen does not say 'no payment' until the server confirms", () => {
    expect(expiryVerdict(null).kind).toBe("unknown");
    expect(expiryVerdict({ ok: false, message: "x" }).kind).toBe("unknown");
    expect(expiryVerdict({ ok: true, status: "paid" }).kind).toBe("paid");
    expect(expiryVerdict({ ok: true, status: "awaiting_payment" }).kind).toBe("not_paid");
    expect(expiryVerdict({ ok: true, status: "weird" }).kind).toBe("unknown");
  });

  it("clock offset uses the server Date header and ignores sub-2s noise", () => {
    const local = Date.parse("2026-10-30T00:00:00Z");
    expect(serverClockOffsetMs("Fri, 30 Oct 2026 00:05:00 GMT", local)).toBe(300_000);
    expect(serverClockOffsetMs("Fri, 30 Oct 2026 00:00:01 GMT", local)).toBe(0);
    expect(serverClockOffsetMs(null, local)).toBe(0);
    expect(serverClockOffsetMs("garbage", local)).toBe(0);
  });
});

describe("F07 status check handles non-2xx and network failures visibly", () => {
  it("502 is an unknown-status error, never 'not paid'", async () => {
    const r = await checkQrStatus(reply(502, { status: "awaiting_payment" }), body, "t");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/502/);
    expect(expiryVerdict(r).kind).toBe("unknown");
  });

  it("401/403 surface the server error text", async () => {
    const r = await checkQrStatus(reply(403, { error: "Not assigned to this store" }), body, "t");
    expect(r).toEqual({ ok: false, message: expect.stringContaining("Not assigned to this store") });
  });

  it("network failure and unreadable bodies are errors", async () => {
    const fail = await checkQrStatus(async () => { throw new TypeError("Failed to fetch"); }, body, "t");
    expect(fail.ok).toBe(false);
    const bad = await checkQrStatus(reply(200, null), body, "t");
    expect(bad.ok).toBe(false);
  });

  it("hung status request times out", async () => {
    const hang = (_u: string, init?: RequestInit) => new Promise<never>((_, rej) => {
      init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    const r = await checkQrStatus(hang, body, "t", 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/timed out/);
  });

  it("2xx returns the reported status and sends auth", async () => {
    let auth = "";
    const r = await checkQrStatus(async (_u, init) => {
      auth = (init?.headers as Record<string, string>).Authorization;
      return { ok: true, status: 200, json: async () => ({ status: "paid" }) };
    }, body, "tok");
    expect(r).toEqual({ ok: true, status: "paid" });
    expect(auth).toBe("Bearer tok");
  });
});
