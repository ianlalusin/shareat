import { describe, it, expect, vi } from "vitest";
import { commitLocalFirst, type Committable } from "@/lib/offline/commit";

describe("commitLocalFirst", () => {
  it("returns synchronously even when the commit never resolves (offline)", () => {
    const batch: Committable = { commit: () => new Promise<void>(() => {}) };
    expect(() => commitLocalFirst(batch)).not.toThrow();
  });

  it("invokes the batch commit exactly once", () => {
    const commit = vi.fn(() => Promise.resolve());
    commitLocalFirst({ commit });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("routes a server-side commit failure to onError", async () => {
    const err = new Error("permission denied");
    const onError = vi.fn();
    commitLocalFirst({ commit: () => Promise.reject(err) }, onError);
    // let the rejection microtask settle
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("swallows a commit failure when no onError is given (no synchronous throw)", () => {
    const commit = vi.fn(() => Promise.reject(new Error("x")));
    expect(() => commitLocalFirst({ commit })).not.toThrow();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
