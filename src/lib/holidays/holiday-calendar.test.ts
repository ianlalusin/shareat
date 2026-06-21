// src/lib/holidays/holiday-calendar.test.ts
import { describe, it, expect } from "vitest";
import {
  slugifyHoliday,
  dayIdToDate,
  buildUpcomingHolidays,
  type HolidayCalendarEntry,
} from "@/lib/holidays/holiday-calendar";

const entry = (name: string): HolidayCalendarEntry => ({
  name, type: "commercial", scope: "national", driver: "up", confidence: "high",
});

describe("slugifyHoliday", () => {
  it("normalizes punctuation and spaces", () => {
    expect(slugifyHoliday("Father's Day")).toBe("fathers-day");
    expect(slugifyHoliday("All Saints' Day")).toBe("all-saints-day");
    expect(slugifyHoliday("Eid'l Fitr")).toBe("eidl-fitr");
  });
});

describe("dayIdToDate", () => {
  it("formats YYYYMMDD to YYYY-MM-DD", () => {
    expect(dayIdToDate("20260615")).toBe("2026-06-15");
  });
});

describe("buildUpcomingHolidays", () => {
  const windowDayIds = ["20260620", "20260621", "20260622"];

  it("includes calendar entries inside the window", () => {
    const res = buildUpcomingHolidays({
      calendarDays: { "20260621": entry("Father's Day") },
      overrides: {},
      windowDayIds,
    });
    expect(res).toEqual([
      { dayId: "20260621", date: "2026-06-21", name: "Father's Day", slug: "fathers-day" },
    ]);
  });

  it("lets a dailyContext override replace the calendar name", () => {
    const res = buildUpcomingHolidays({
      calendarDays: { "20260621": entry("Father's Day") },
      overrides: { "20260621": "Store Anniversary" },
      windowDayIds,
    });
    expect(res[0].name).toBe("Store Anniversary");
    expect(res[0].slug).toBe("store-anniversary");
  });

  it("treats override 'None' as a clear", () => {
    const res = buildUpcomingHolidays({
      calendarDays: { "20260621": entry("Father's Day") },
      overrides: { "20260621": "None" },
      windowDayIds,
    });
    expect(res).toEqual([]);
  });

  it("ignores days outside the window", () => {
    const res = buildUpcomingHolidays({
      calendarDays: { "20260615": entry("Mother's Day") },
      overrides: {},
      windowDayIds,
    });
    expect(res).toEqual([]);
  });
});
