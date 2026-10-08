import { describe, it, expect } from "vitest";
import { buildDayContext, daysToLearn, type ContextSources } from "@/lib/forecast/context";
import { effectivePaydays } from "@/lib/forecast/payday";

const base = (over: Partial<ContextSources> = {}): ContextSources => ({
  calendarNames: {}, holidayOverrides: {}, staffPaydays: new Set(), effects: {},
  paydays: effectivePaydays([10, 31], "2026-10-01", "2026-10-31"), weather: {}, ...over,
});

describe("buildDayContext", () => {
  it("looks up a calendar holiday's measured lift by slug", () => {
    const src = base({
      calendarNames: { "20261225": "Christmas Day" },
      effects: { "christmas-day": { name: "Christmas Day", slug: "christmas-day", avgLiftPct: 34, samples: 2, lastDate: "2025-12-25", occurrences: [] } },
    });
    expect(buildDayContext("2026-12-25", src, "forecast").holiday).toEqual({ name: "Christmas Day", liftPct: 34 });
  });
  it("an override of 'None' clears a calendar holiday", () => {
    const src = base({ calendarNames: { "20261225": "Christmas Day" }, holidayOverrides: { "20261225": "None" } });
    expect(buildDayContext("2026-12-25", src, "learn").holiday).toBeNull();
  });
  it("a holiday with no measured history has liftPct null", () => {
    expect(buildDayContext("2026-10-20", base({ calendarNames: { "20261020": "Fiesta" } }), "forecast").holiday)
      .toEqual({ name: "Fiesta", liftPct: null });
  });
  it("learn mode counts any logged PM rain; forecast mode needs a high chance or heavy rain", () => {
    const light = base({ weather: { "20261020": { pm: "light_rain", pop: 0.3 } } });
    expect(buildDayContext("2026-10-20", light, "learn").rain).toBe(true);
    expect(buildDayContext("2026-10-20", light, "forecast").rain).toBe(false);
    expect(buildDayContext("2026-10-20", base({ weather: { "20261020": { pm: "light_rain", pop: 0.7 } } }), "forecast").rain).toBe(true);
    expect(buildDayContext("2026-10-20", base({ weather: { "20261020": { pm: "heavy_rain", pop: 0.2 } } }), "forecast").rain).toBe(true);
    expect(buildDayContext("2026-10-20", base(), "learn").rain).toBe(false); // no weather logged
  });
  it("attaches the payday hit and weekday", () => {
    const c = buildDayContext("2026-10-09", base(), "forecast");
    expect(c.dow).toBe(5);
    expect(c.payday).toMatchObject({ offset: 0, cls: "fri", shiftedFrom: "2026-10-10" });
  });
  it("uses a staff-confirmed payday", () => {
    expect(buildDayContext("2026-10-20", base({ staffPaydays: new Set(["20261020"]) }), "learn").payday?.offset).toBe(0);
  });
});

describe("daysToLearn", () => {
  const today = "2026-10-08";
  it("returns every day after processedThrough up to yesterday", () => {
    expect(daysToLearn("2026-10-05", today, () => true)).toEqual(["2026-10-06", "2026-10-07"]);
  });
  it("stops at a missing day within the last 2 days (not synced yet) so it retries tomorrow", () => {
    const has = (d: string) => d !== "2026-10-07";
    expect(daysToLearn("2026-10-05", today, has)).toEqual(["2026-10-06"]);
  });
  it("keeps older missing days (closed) so learning moves on", () => {
    const has = (d: string) => d !== "2026-10-02";
    expect(daysToLearn("2026-09-30", today, has)).toContain("2026-10-02");
  });
  it("bootstraps from today − 90 when nothing has been learned", () => {
    const ds = daysToLearn(null, today, () => true);
    expect(ds[0]).toBe("2026-07-10");
    expect(ds.at(-1)).toBe("2026-10-07");
    expect(ds).toHaveLength(90);
  });
  it("returns nothing when already up to date", () => {
    expect(daysToLearn("2026-10-07", today, () => true)).toEqual([]);
  });
});
