import { describe, it, expect } from "vitest";
import {
  computeBaseline,
  computeHolidayEffects,
  enrichUpcomingHolidays,
  type LabeledHolidayDay,
  type HolidayEffect,
} from "@/lib/holidays/holiday-effects";

describe("computeBaseline", () => {
  it("averages same-weekday, non-holiday, non-zero days within ±28d", () => {
    const sales = { "2026-06-21": 1000, "2026-05-31": 300, "2026-06-14": 200 }; // all Sundays
    expect(computeBaseline("2026-06-21", sales, new Set())).toBe(250);
  });

  it("returns null with fewer than 2 qualifying samples", () => {
    const sales = { "2026-06-21": 1000, "2026-06-14": 200, "2026-06-19": 500 }; // 06-19 is Friday
    expect(computeBaseline("2026-06-21", sales, new Set())).toBeNull();
  });

  it("excludes holiday and zero-sales days", () => {
    const sales = { "2026-06-21": 1000, "2026-06-14": 200, "2026-06-07": 0, "2026-05-31": 400 };
    // 06-07 excluded (zero); 05-31 holiday → excluded; only 06-14 left → null
    expect(computeBaseline("2026-06-21", sales, new Set(["2026-05-31"]))).toBeNull();
  });
});

describe("computeHolidayEffects", () => {
  const labeled: LabeledHolidayDay[] = [
    { date: "2025-06-15", name: "Father's Day" },
    { date: "2026-06-21", name: "Father's Day" },
  ];
  const sales: Record<string, number> = {
    // 2025 Sundays: baseline 100, actual 140 -> +40%
    "2025-06-01": 100, "2025-06-08": 100, "2025-06-15": 140, "2025-06-22": 100, "2025-06-29": 100,
    // 2026 Sundays: baseline 200, actual 320 -> +60%
    "2026-06-07": 200, "2026-06-14": 200, "2026-06-21": 320, "2026-06-28": 200,
  };

  it("computes EWMA lift across occurrences (latest weighted most)", () => {
    const effects = computeHolidayEffects(labeled, sales);
    const fd = effects["fathers-day"];
    expect(fd.samples).toBe(2);
    expect(fd.lastDate).toBe("2026-06-21");
    expect(fd.occurrences).toHaveLength(2);
    // EWMA alpha 0.5 over [40, 60] = 0.5*60 + 0.5*40 = 50
    expect(fd.avgLiftPct).toBe(50);
  });

  it("skips occurrences with zero/no actual sales", () => {
    const withClosed = [...labeled, { date: "2026-01-01", name: "New Year's Day" }];
    const effects = computeHolidayEffects(withClosed, sales); // no 2026-01-01 sales
    expect(effects["new-years-day"]).toBeUndefined();
  });
});

describe("enrichUpcomingHolidays", () => {
  const upcoming = [
    { dayId: "20260621", date: "2026-06-21", name: "Father's Day", slug: "fathers-day" },
    { dayId: "20260217", date: "2026-02-17", name: "Chinese New Year", slug: "chinese-new-year" },
  ];

  it("renders measured lift with weekday and sample count", () => {
    const effects: Record<string, HolidayEffect> = {
      "fathers-day": { name: "Father's Day", slug: "fathers-day", avgLiftPct: 34, samples: 2, lastDate: "2026-06-21", occurrences: [] },
    };
    const out = enrichUpcomingHolidays(upcoming, effects);
    expect(out[0]).toContain("+34%");
    expect(out[0]).toContain("Sunday");
    expect(out[0]).toContain("2 past occasions");
    expect(out[1]).toContain("no measured history");
  });

  it("renders a negative lift and singular occasion", () => {
    const effects: Record<string, HolidayEffect> = {
      "fathers-day": { name: "Father's Day", slug: "fathers-day", avgLiftPct: -10, samples: 1, lastDate: "2025-06-15", occurrences: [] },
    };
    const out = enrichUpcomingHolidays(upcoming, effects);
    expect(out[0]).toContain("-10%");
    expect(out[0]).toContain("1 past occasion");
  });
});
