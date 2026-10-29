import { describe, it, expect } from "vitest";
import { decideOfflineReplay } from "@/lib/offline/offlineSyncGate";

const sale = { kind: "payment" as const, sessionId: "sess123456", receiptNumber: "OL-A-1", offlineWriteId: "w1" };
const myReceipt = { status: "final", offlineOrigin: true, receiptNumber: "OL-A-1" };
const closedByMe = { status: "closed", offlineWriteId: "w1" };

describe("decideOfflineReplay (audit B17)", () => {
  it("replays only when the server has this device's receipt and the session is closed", () => {
    expect(decideOfflineReplay(sale, myReceipt, closedByMe)).toEqual({ action: "replay" });
  });
  it("waits while the batch has not reached the server (no receipt, session open)", () => {
    expect(decideOfflineReplay(sale, null, { status: "active" }).action).toBe("wait");
  });
  it("waits when the session doc is not visible on the server", () => {
    expect(decideOfflineReplay(sale, null, null).action).toBe("wait");
  });
  it("conflicts on an online receipt", () => {
    expect(decideOfflineReplay(sale, { status: "final" }, { status: "closed" }).action).toBe("conflict");
  });
  it("conflicts on another terminal's offline receipt", () => {
    const d = decideOfflineReplay(sale, { ...myReceipt, receiptNumber: "OL-B-1" }, { status: "closed", offlineWriteId: "w2" });
    expect(d.action).toBe("conflict");
  });
  it("conflicts when another offline write closed the session", () => {
    expect(decideOfflineReplay(sale, myReceipt, { status: "closed", offlineWriteId: "w2" }).action).toBe("conflict");
  });
  it("conflicts when the session was closed/voided without this receipt (batch rejected)", () => {
    expect(decideOfflineReplay(sale, null, { status: "voided" }).action).toBe("conflict");
    expect(decideOfflineReplay(sale, null, { status: "closed" }).action).toBe("conflict");
  });
  it("legacy queue items without receiptNumber/offlineWriteId still replay on a confirmed offline receipt", () => {
    const legacy = { kind: undefined, sessionId: "sess123456" };
    expect(decideOfflineReplay(legacy, myReceipt, { status: "closed" })).toEqual({ action: "replay" });
  });

  describe("voids", () => {
    const v = { kind: "void" as const, sessionId: "sess123456" };
    it("replays once the server shows the session voided", () => {
      expect(decideOfflineReplay(v, null, { status: "voided" })).toEqual({ action: "replay" });
    });
    it("waits while the void has not landed", () => {
      expect(decideOfflineReplay(v, null, { status: "active" }).action).toBe("wait");
    });
    it("conflicts when the session was paid on the server", () => {
      expect(decideOfflineReplay(v, null, { status: "closed", isPaid: true }).action).toBe("conflict");
    });
  });
});
