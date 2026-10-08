import { describe, it, expect } from "vitest";
import { buildForecastConfig, getUpcomingPayrollDates } from "@/lib/utils/forecast-helpers";

describe("getUpcomingPayrollDates", () => {
  // 2026-10-08 05:00 Manila = 2026-10-07T21:00Z (the cron's real firing time)
  const now = Date.parse("2026-10-07T21:00:00Z");
  it("uses the Manila date, clamps 31 to EOM, and shifts weekends to Friday", () => {
    const ds = getUpcomingPayrollDates({ payrollScheduleType: "custom", customPayrollDates: [10, 31] }, now);
    expect(ds.slice(0, 3)).toEqual(["2026-10-09", "2026-10-30", "2026-11-10"]);
  });
  it("never spills a 31st into the next month", () => {
    const ds = getUpcomingPayrollDates({ payrollScheduleType: "custom", customPayrollDates: [31] }, now);
    expect(ds).toContain("2026-11-30");
    expect(ds).not.toContain("2026-12-01");
  });
});

describe("buildForecastConfig", () => {
  it("keeps the engine and parses only valid day numbers", () => {
    expect(buildForecastConfig({ holidays: [], payrollDatesText: "10, 31, x, 0, 40", storeContext: "  near school ", engine: "model" }))
      .toEqual({ customHolidays: [], payrollScheduleType: "custom", customPayrollDates: [10, 31], storeContext: "near school", engine: "model" });
  });
});
