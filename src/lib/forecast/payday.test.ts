import { describe, it, expect } from "vitest";
import { addDaysYmd, dowOf, effectivePaydays, paydayDaysOfMonth, paydayHitFor } from "@/lib/forecast/payday";

describe("date helpers", () => {
  it("adds days across a month edge and reads the weekday from the string", () => {
    expect(addDaysYmd("2026-10-30", 3)).toBe("2026-11-02");
    expect(dowOf("2026-10-08")).toBe(4); // Thursday
  });
});

describe("paydayDaysOfMonth", () => {
  it("defaults to 15th + end of month", () => {
    expect(paydayDaysOfMonth(undefined)).toEqual([15, 31]);
  });
  it("uses custom dates", () => {
    expect(paydayDaysOfMonth({ payrollScheduleType: "custom", customPayrollDates: [10, 31] })).toEqual([10, 31]);
  });
  it("disables the payday factor for weekly and bi-weekly payroll", () => {
    expect(paydayDaysOfMonth({ payrollScheduleType: "weekly" })).toBeNull();
    expect(paydayDaysOfMonth({ payrollScheduleType: "bi_weekly" })).toBeNull();
  });
  it("returns null for custom with no dates", () => {
    expect(paydayDaysOfMonth({ payrollScheduleType: "custom", customPayrollDates: [] })).toBeNull();
  });
});

describe("effectivePaydays", () => {
  const oct = effectivePaydays([10, 31], "2026-10-01", "2026-10-31");
  it("shifts a Saturday 10th back to Friday the 9th", () => {
    expect(oct).toContainEqual({ date: "2026-10-09", nominal: "2026-10-10", shifted: true });
  });
  it("shifts a Saturday EOM back to Friday", () => {
    expect(oct).toContainEqual({ date: "2026-10-30", nominal: "2026-10-31", shifted: true });
  });
  it("keeps a weekday payday unshifted", () => {
    expect(effectivePaydays([10], "2026-09-01", "2026-09-30")).toContainEqual({ date: "2026-09-10", nominal: "2026-09-10", shifted: false });
  });
  it("clamps 31 to the month's last day (Nov 30, a Monday)", () => {
    expect(effectivePaydays([31], "2026-11-01", "2026-11-30")).toContainEqual({ date: "2026-11-30", nominal: "2026-11-30", shifted: false });
  });
  it("clamps February EOM then shifts Sat Feb 28 to Fri Feb 27", () => {
    expect(effectivePaydays([31], "2026-02-01", "2026-02-28")).toContainEqual({ date: "2026-02-27", nominal: "2026-02-28", shifted: true });
  });
  it("shifts a Sunday 15th back two days to Friday", () => {
    expect(effectivePaydays([15], "2026-11-01", "2026-11-30")).toContainEqual({ date: "2026-11-13", nominal: "2026-11-15", shifted: true });
  });
  it("includes the previous month's paydays so early-month dates see a +1/+2 offset", () => {
    expect(effectivePaydays([31], "2026-11-01", "2026-11-02").map((p) => p.date)).toContain("2026-10-30");
  });
  it("is sorted and de-duplicated", () => {
    const ds = effectivePaydays([30, 31], "2026-10-01", "2026-10-31").map((p) => p.date);
    expect(ds).toEqual([...new Set(ds)].sort());
  });
});

describe("paydayHitFor", () => {
  const pays = effectivePaydays([10, 31], "2026-10-01", "2026-10-31");
  it("labels the shifted Friday payday as offset 0, class fri", () => {
    expect(paydayHitFor("2026-10-09", pays)).toEqual({ offset: 0, cls: "fri", shiftedFrom: "2026-10-10", payday: "2026-10-09" });
  });
  it("covers the day before and two days after", () => {
    expect(paydayHitFor("2026-10-08", pays)?.offset).toBe(-1);
    expect(paydayHitFor("2026-10-10", pays)?.offset).toBe(1);
    expect(paydayHitFor("2026-10-11", pays)?.offset).toBe(2);
    expect(paydayHitFor("2026-10-12", pays)).toBeNull();
  });
  it("classes a Thursday payday as wkday", () => {
    const sep = effectivePaydays([10], "2026-09-01", "2026-09-30");
    expect(paydayHitFor("2026-09-10", sep)?.cls).toBe("wkday");
  });
  it("on overlap, the nearest payday wins; ties go to the payday already passed", () => {
    const close = effectivePaydays([5, 7], "2026-10-01", "2026-10-31"); // Mon 5th, Wed 7th
    expect(paydayHitFor("2026-10-06", close)).toMatchObject({ offset: 1, payday: "2026-10-05" });
    expect(paydayHitFor("2026-10-07", close)).toMatchObject({ offset: 0, payday: "2026-10-07" });
  });
  it("a staff-confirmed payday with no computed one becomes an offset-0 hit", () => {
    expect(paydayHitFor("2026-10-20", pays, true)).toEqual({ offset: 0, cls: "wkday", shiftedFrom: null, payday: "2026-10-20" });
  });
});
