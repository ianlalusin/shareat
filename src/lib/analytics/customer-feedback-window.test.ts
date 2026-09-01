import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  WEEK_MS,
  getManilaWeekStartMs,
  resolveCandidateWindow,
  feedbackFallbackWindows,
  hasFeedbackToday,
} from "./customer-feedback-window";

// Sunday 00:00 Manila (+08:00), chosen independently of the implementation.
const SUN_START = new Date("2026-08-30T00:00:00+08:00").getTime();

describe("getManilaWeekStartMs", () => {
  it("returns the same instant for Sunday 00:00 Manila", () => {
    expect(getManilaWeekStartMs(SUN_START)).toBe(SUN_START);
  });

  it("maps a midweek instant back to that week's Sunday 00:00 Manila", () => {
    const wednesdayAfternoon = SUN_START + 3 * DAY_MS + 15 * 60 * 60 * 1000;
    expect(getManilaWeekStartMs(wednesdayAfternoon)).toBe(SUN_START);
  });

  it("maps the last millisecond of Saturday to the same week's Sunday", () => {
    const saturdayEndOfDay = SUN_START + WEEK_MS - 1;
    expect(getManilaWeekStartMs(saturdayEndOfDay)).toBe(SUN_START);
  });

  it("maps the first millisecond of the next Sunday to itself, not the previous week", () => {
    expect(getManilaWeekStartMs(SUN_START + WEEK_MS)).toBe(SUN_START + WEEK_MS);
  });
});

describe("resolveCandidateWindow", () => {
  it("snaps a single-day range to the containing Manila week", () => {
    const wednesday00 = SUN_START + 3 * DAY_MS;
    const wednesday2359999 = wednesday00 + DAY_MS - 1;
    const result = resolveCandidateWindow({ start: wednesday00, end: wednesday2359999 });
    expect(result).toEqual({ startMs: SUN_START, endMs: SUN_START + WEEK_MS });
  });

  it("does not snap a range spanning a full week (endOfDay-style inclusive end)", () => {
    const end = SUN_START + 6 * DAY_MS + (DAY_MS - 1); // "last 7 days", 23:59:59.999 on day 6
    const result = resolveCandidateWindow({ start: SUN_START, end });
    expect(result).toEqual({ startMs: SUN_START, endMs: end + 1 });
  });

  it("does not snap a month-long range", () => {
    const start = SUN_START;
    const end = SUN_START + 30 * DAY_MS + (DAY_MS - 1);
    const result = resolveCandidateWindow({ start, end });
    expect(result).toEqual({ startMs: start, endMs: end + 1 });
  });

  it("snaps a range that starts mid-week to that week's Sunday, not the range's own start", () => {
    const tuesday00 = SUN_START + 2 * DAY_MS;
    const tuesday2359999 = tuesday00 + DAY_MS - 1;
    const result = resolveCandidateWindow({ start: tuesday00, end: tuesday2359999 });
    expect(result.startMs).toBe(SUN_START);
  });

  it("accepts Date instances the same way it accepts epoch ms", () => {
    const wednesday00 = SUN_START + 3 * DAY_MS;
    const wednesday2359999 = wednesday00 + DAY_MS - 1;
    const result = resolveCandidateWindow({
      start: new Date(wednesday00),
      end: new Date(wednesday2359999),
    });
    expect(result).toEqual({ startMs: SUN_START, endMs: SUN_START + WEEK_MS });
  });
});

describe("feedbackFallbackWindows", () => {
  it("starts with the resolved candidate window", () => {
    const wednesday00 = SUN_START + 3 * DAY_MS;
    const wednesday2359999 = wednesday00 + DAY_MS - 1;
    const windows = feedbackFallbackWindows({ start: wednesday00, end: wednesday2359999 });
    expect(windows[0]).toEqual({ startMs: SUN_START, endMs: SUN_START + WEEK_MS });
  });

  it("steps each subsequent window back by exactly one window size", () => {
    const windows = feedbackFallbackWindows({ start: SUN_START, end: SUN_START + WEEK_MS - 1 }, 3);
    expect(windows).toEqual([
      { startMs: SUN_START, endMs: SUN_START + WEEK_MS },
      { startMs: SUN_START - WEEK_MS, endMs: SUN_START },
      { startMs: SUN_START - 2 * WEEK_MS, endMs: SUN_START - WEEK_MS },
      { startMs: SUN_START - 3 * WEEK_MS, endMs: SUN_START - 2 * WEEK_MS },
    ]);
  });

  it("returns exactly maxSteps + 1 windows", () => {
    const windows = feedbackFallbackWindows({ start: SUN_START, end: SUN_START + WEEK_MS - 1 }, 52);
    expect(windows).toHaveLength(53);
  });
});

describe("hasFeedbackToday", () => {
  it("is true when the most recent feedback is dated the same Manila day as now", () => {
    const now = SUN_START + 3 * DAY_MS + 10 * 60 * 60 * 1000; // Wed 10:00 Manila
    const sameDayEarlier = SUN_START + 3 * DAY_MS + 1 * 60 * 60 * 1000; // Wed 01:00 Manila
    expect(hasFeedbackToday(sameDayEarlier, now)).toBe(true);
  });

  it("is false when the most recent feedback is from a previous Manila day", () => {
    const now = SUN_START + 3 * DAY_MS + 10 * 60 * 60 * 1000; // Wed 10:00 Manila
    const yesterday = SUN_START + 2 * DAY_MS + 23 * 60 * 60 * 1000; // Tue 23:00 Manila
    expect(hasFeedbackToday(yesterday, now)).toBe(false);
  });

  it("is false when there is no feedback at all", () => {
    expect(hasFeedbackToday(null, Date.now())).toBe(false);
  });

  it("is true right at the Manila day boundary", () => {
    const now = SUN_START + 3 * DAY_MS; // Wed 00:00:00.000 Manila
    expect(hasFeedbackToday(now, now)).toBe(true);
  });
});
