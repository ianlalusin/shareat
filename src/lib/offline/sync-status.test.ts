import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNCED_FLASH_MS,
  __resetSyncRuntime,
  deriveSyncBanner,
  getSyncRuntime,
  registerSyncRetry,
  requestSyncRetry,
  setSyncRuntime,
  subscribeSyncRuntime,
  summarizeQueue,
  type SyncRuntime,
} from "./sync-status";

// Audit F23: the banner must reflect the real payment queue, not navigator.onLine.

const idle: SyncRuntime = { syncing: false, stalled: false, lastCompletedCount: 0, lastCompletedAt: null };
const NOW = 1_800_000_000_000;
const none = { pending: 0, failed: 0, total: 0 };

describe("summarizeQueue", () => {
  it("counts pending (incl. stale syncing) and failed", () => {
    expect(summarizeQueue([{ status: "pending" }, { status: "syncing" }, { status: "failed" }])).toEqual({
      pending: 2,
      failed: 1,
      total: 3,
    });
    expect(summarizeQueue([])).toEqual(none);
  });
});

describe("deriveSyncBanner", () => {
  it("reconnect with an empty queue shows nothing (no fake 'synced')", () => {
    const b = deriveSyncBanner({ online: true, counts: none, runtime: idle, now: NOW });
    expect(b.visible).toBe(false);
  });

  it("offline shows the queued count", () => {
    const b = deriveSyncBanner({ online: false, counts: { pending: 2, failed: 0, total: 2 }, runtime: idle, now: NOW });
    expect(b).toMatchObject({ visible: true, tone: "offline" });
    expect(b.text).toContain("2 offline sales");
  });

  it("stays visible while items are pending after reconnect, with Retry", () => {
    const b = deriveSyncBanner({ online: true, counts: { pending: 1, failed: 0, total: 1 }, runtime: idle, now: NOW + 60_000 });
    expect(b).toMatchObject({ visible: true, showRetry: true });
    expect(b.text).toContain("1 offline sale waiting");
  });

  it("shows syncing without Retry during a drain", () => {
    const b = deriveSyncBanner({ online: true, counts: { pending: 3, failed: 0, total: 3 }, runtime: { ...idle, syncing: true }, now: NOW });
    expect(b).toMatchObject({ visible: true, tone: "info", showRetry: false });
    expect(b.text).toMatch(/Syncing 3/);
  });

  it("exhausted retries: warning that stays, with Retry", () => {
    const b = deriveSyncBanner({ online: true, counts: { pending: 1, failed: 0, total: 1 }, runtime: { ...idle, stalled: true }, now: NOW + 3_600_000 });
    expect(b).toMatchObject({ visible: true, tone: "warning", showRetry: true });
  });

  it("failed (conflict) items keep an error banner even after a recent success", () => {
    const b = deriveSyncBanner({
      online: true,
      counts: { pending: 0, failed: 1, total: 1 },
      runtime: { ...idle, lastCompletedCount: 2, lastCompletedAt: NOW },
      now: NOW + 1,
    });
    expect(b).toMatchObject({ visible: true, tone: "error", showRetry: true });
  });

  it("'synced' only after confirmed items, and only briefly", () => {
    const rt = { ...idle, lastCompletedCount: 2, lastCompletedAt: NOW };
    expect(deriveSyncBanner({ online: true, counts: none, runtime: rt, now: NOW + 100 })).toMatchObject({
      visible: true,
      tone: "success",
      text: "2 offline sales synced.",
    });
    expect(deriveSyncBanner({ online: true, counts: none, runtime: rt, now: NOW + SYNCED_FLASH_MS }).visible).toBe(false);
  });

  it("flapping back offline right after a sync shows offline, not synced", () => {
    const rt = { ...idle, lastCompletedCount: 1, lastCompletedAt: NOW };
    expect(deriveSyncBanner({ online: false, counts: none, runtime: rt, now: NOW + 10 }).tone).toBe("offline");
  });
});

describe("sync runtime store", () => {
  beforeEach(() => __resetSyncRuntime());

  it("notifies subscribers and merges patches", () => {
    const fn = vi.fn();
    const unsub = subscribeSyncRuntime(fn);
    setSyncRuntime({ syncing: true });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getSyncRuntime()).toMatchObject({ syncing: true, stalled: false });
    unsub();
    setSyncRuntime({ syncing: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retry is a no-op until the sync hook registers a handler", () => {
    expect(requestSyncRetry()).toBe(false);
    const h = vi.fn();
    registerSyncRetry(h);
    expect(requestSyncRetry()).toBe(true);
    expect(h).toHaveBeenCalledOnce();
  });
});
