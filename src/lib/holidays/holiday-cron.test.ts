import { describe, it, expect } from "vitest";
import { monthKey, pickDueStores, yearsToGenerate } from "@/lib/holidays/holiday-cron";

describe("monthKey", () => {
  it("keys by calendar month", () => {
    expect(monthKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01");
    expect(monthKey(new Date(Date.UTC(2026, 0, 31)))).toBe("2026-01");
    expect(monthKey(new Date(Date.UTC(2026, 11, 31)))).toBe("2026-12");
  });

  it("keeps every day of a month on the same key", () => {
    const keys = new Set(
      Array.from({ length: 28 }, (_, i) => monthKey(new Date(Date.UTC(2026, 1, i + 1)))),
    );
    expect([...keys]).toEqual(["2026-02"]);
  });
});

describe("pickDueStores", () => {
  it("returns every store not yet done", () => {
    expect(pickDueStores(["a", "b", "c"], ["a"])).toEqual(["b", "c"]);
  });

  it("returns empty when all are done", () => {
    expect(pickDueStores(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("ignores done ids that are no longer active stores", () => {
    expect(pickDueStores(["a"], ["a", "zz-deleted"])).toEqual([]);
    expect(pickDueStores(["a", "b"], ["zz-deleted"])).toEqual(["a", "b"]);
  });

  it("handles an empty store list", () => {
    expect(pickDueStores([], [])).toEqual([]);
  });
});

describe("yearsToGenerate", () => {
  it("returns prior + current year", () => {
    expect(yearsToGenerate(new Date(Date.UTC(2026, 5, 15)))).toEqual([2025, 2026]);
  });
  it("adds next year in December", () => {
    expect(yearsToGenerate(new Date(Date.UTC(2026, 11, 10)))).toEqual([2025, 2026, 2027]);
  });
});
