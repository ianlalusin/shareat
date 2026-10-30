import { describe, it, expect, vi } from "vitest";
import { ReceiptLoader, maybeAutoprint, receiptLoadKey, type ReceiptLoadState } from "./receiptLoad";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe("receipt page loading + autoprint (F14)", () => {
  it("delayed A then B: shows B, never A, and autoprints B only", async () => {
    const pending: Record<string, ReturnType<typeof deferred<{ id: string }>>> = {};
    const fetcher = vi.fn((store: string, id: string) => (pending[`${store}/${id}`] = deferred<{ id: string }>()).promise);
    const states: ReceiptLoadState<{ id: string }>[] = [];
    const loader = new ReceiptLoader(fetcher, s => states.push(s));
    const storage = memoryStorage();
    const attempted = new Set<string>();
    const printed: string[] = [];
    const print = vi.fn(async (s: ReceiptLoadState<{ id: string }>) => { printed.push(s.data!.id); return true; });
    const runAutoprint = (requestedKey: string | null) =>
      maybeAutoprint({ enabled: true, ready: true, requestedKey, state: loader.state, attempted, storage, print });

    loader.load("s1", "A");
    expect(loader.state.status).toBe("loading");
    loader.load("s1", "B"); // user navigated to B before A returned
    const requested = receiptLoadKey("s1", "B");
    expect(loader.state).toMatchObject({ key: "s1/B", status: "loading", data: null });

    pending["s1/B"].resolve({ id: "B" });
    await tick();
    await runAutoprint(requested);
    pending["s1/A"].resolve({ id: "A" }); // late, superseded
    await tick();
    await runAutoprint(requested);

    expect(loader.state).toMatchObject({ key: "s1/B", status: "loaded", data: { id: "B" } });
    expect(states.some(s => s.data?.id === "A")).toBe(false);
    expect(printed).toEqual(["B"]);
    expect(storage.m.get("autoprint:s1:B")).toBe("1");
    expect(storage.m.has("autoprint:s1:A")).toBe(false);
  });

  it("does not autoprint stale data while the new key is loading", async () => {
    const d1 = deferred<{ id: string }>();
    const d2 = deferred<{ id: string }>();
    const loader = new ReceiptLoader<{ id: string }>(vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise), () => {});
    loader.load("s1", "A");
    d1.resolve({ id: "A" });
    await tick();
    loader.load("s1", "B");
    const print = vi.fn(async () => true);
    const r = await maybeAutoprint({ enabled: true, ready: true, requestedKey: "s1/B", state: loader.state, attempted: new Set(), storage: memoryStorage(), print });
    expect(r).toBeNull();
    expect(print).not.toHaveBeenCalled();
    expect(loader.state.data).toBeNull();
  });

  it("marks printed only after a dispatched print, and does not loop on failure", async () => {
    const loader = new ReceiptLoader(async () => ({ id: "A" }), () => {});
    loader.load("s1", "A");
    await tick();
    const storage = memoryStorage();
    const attempted = new Set<string>();
    const print = vi.fn(async () => false);
    await maybeAutoprint({ enabled: true, ready: true, requestedKey: "s1/A", state: loader.state, attempted, storage, print });
    await maybeAutoprint({ enabled: true, ready: true, requestedKey: "s1/A", state: loader.state, attempted, storage, print });
    expect(print).toHaveBeenCalledTimes(1);
    expect(storage.m.size).toBe(0);
  });

  it("a failed first load followed by a retry succeeds, and a branch switch keys separately", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ id: "A" })
      .mockResolvedValueOnce({ id: "A@s2" });
    const loader = new ReceiptLoader<{ id: string }>(fetcher, () => {});
    loader.load("s1", "A");
    await tick();
    expect(loader.state).toMatchObject({ status: "error", error: "offline", data: null });
    loader.load("s1", "A");
    await tick();
    expect(loader.state).toMatchObject({ status: "loaded", data: { id: "A" } });
    loader.load("s2", "A");
    expect(loader.state).toMatchObject({ key: "s2/A", status: "loading", data: null });
    await tick();
    expect(loader.state.data).toEqual({ id: "A@s2" });
  });

  it("dispose ignores an in-flight fetch and lets a remount refetch", async () => {
    const d = deferred<{ id: string }>();
    const fetcher = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValueOnce({ id: "A2" });
    const loader = new ReceiptLoader<{ id: string }>(fetcher, () => {});
    loader.load("s1", "A");
    loader.dispose();
    d.resolve({ id: "A1" });
    await tick();
    expect(loader.state.status).toBe("idle");
    loader.load("s1", "A");
    await tick();
    expect(loader.state.data).toEqual({ id: "A2" });
  });
});
