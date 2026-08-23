import { describe, it, expect } from "vitest";
import { monthKey, pickDueStores, yearsToGenerate, decideCalendarWrite } from "@/lib/holidays/holiday-cron";

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

/**
 * The calendar is now written wholesale rather than deep-merged, so a
 * correction can actually remove a wrong entry. That trade gives up the
 * protection `merge: true` provided against the model simply omitting
 * something it knew last month — this guard buys it back without the
 * stickiness that made errors permanent.
 */
describe("decideCalendarWrite", () => {
  it("writes a normal regeneration", () => {
    expect(decideCalendarWrite(31, 31).action).toBe("write");
    expect(decideCalendarWrite(31, 33).action).toBe("write");
    expect(decideCalendarWrite(0, 28).action).toBe("write");
  });

  it("writes a small shrink — corrections legitimately remove entries", () => {
    // Lipa dropping its two wrong Manila fiestas is exactly this case.
    expect(decideCalendarWrite(31, 29).action).toBe("write");
    expect(decideCalendarWrite(31, 20).action).toBe("write");
  });

  it("REFUSES to blank a populated year", () => {
    const d = decideCalendarWrite(31, 0);
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/0 entries/i);
  });

  it("REFUSES a collapse to under half of a substantial year", () => {
    const d = decideCalendarWrite(31, 5);
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/collapse/i);
  });

  it("allows any count when the existing year is thin — nothing to protect", () => {
    expect(decideCalendarWrite(4, 1).action).toBe("write");
    expect(decideCalendarWrite(9, 2).action).toBe("write");
  });

  it("treats a missing existing doc as nothing to protect", () => {
    expect(decideCalendarWrite(undefined, 1).action).toBe("write");
  });
});
