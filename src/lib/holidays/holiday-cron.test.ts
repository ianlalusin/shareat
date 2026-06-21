import { describe, it, expect } from "vitest";
import { isoWeekKey, pickDueStore, yearsToGenerate } from "@/lib/holidays/holiday-cron";

describe("isoWeekKey", () => {
  it("computes ISO week (UTC)", () => {
    expect(isoWeekKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-W01");
    expect(isoWeekKey(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-W02");
  });
});

describe("pickDueStore", () => {
  it("returns the first store not yet done", () => {
    expect(pickDueStore(["a", "b", "c"], ["a"])).toBe("b");
  });
  it("returns null when all are done", () => {
    expect(pickDueStore(["a", "b"], ["a", "b"])).toBeNull();
  });
});

describe("yearsToGenerate", () => {
  it("returns prior + current year normally", () => {
    expect(yearsToGenerate(new Date(Date.UTC(2026, 5, 15)))).toEqual([2025, 2026]);
  });
  it("adds next year in December", () => {
    expect(yearsToGenerate(new Date(Date.UTC(2026, 11, 10)))).toEqual([2025, 2026, 2027]);
  });
});
