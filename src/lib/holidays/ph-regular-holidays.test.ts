import { describe, it, expect } from "vitest";
import { getPresetHolidayName } from "@/lib/holidays/ph-regular-holidays";

describe("getPresetHolidayName — fixed-date holidays", () => {
  it("resolves the genuinely fixed dates", () => {
    expect(getPresetHolidayName("20261225")).toBe("Christmas Day");
    expect(getPresetHolidayName("20260612")).toBe("Independence Day");
    expect(getPresetHolidayName("20260821")).toBe("Ninoy Aquino Day");
    expect(getPresetHolidayName("20260101")).toBe("New Year's Day");
  });

  it("returns null for an ordinary day", () => {
    expect(getPresetHolidayName("20260715")).toBeNull();
  });

  it("returns null for a malformed dayId", () => {
    expect(getPresetHolidayName("2026")).toBeNull();
    expect(getPresetHolidayName("")).toBeNull();
  });
});

/**
 * National Heroes Day is the LAST MONDAY of August, not a fixed date. It was
 * hardcoded as "0830" in the MMDD table, so the weather calendar marked the
 * wrong day in every year where the 30th is not the last Monday — including
 * 2026, where it falls on the 31st. The table's own comment says variable-date
 * holidays do not belong in it.
 */
describe("getPresetHolidayName — National Heroes Day is variable", () => {
  it("lands on the last Monday of August, which moves each year", () => {
    expect(getPresetHolidayName("20240826")).toBe("National Heroes Day");
    expect(getPresetHolidayName("20250825")).toBe("National Heroes Day");
    expect(getPresetHolidayName("20260831")).toBe("National Heroes Day");
    expect(getPresetHolidayName("20280828")).toBe("National Heroes Day");
  });

  it("still works in a year where it genuinely is the 30th", () => {
    // 2027 is the case the old hardcoded "0830" happened to get right.
    expect(getPresetHolidayName("20270830")).toBe("National Heroes Day");
  });

  it("no longer marks Aug 30 in a year where that is NOT the last Monday", () => {
    expect(getPresetHolidayName("20260830")).toBeNull();
    expect(getPresetHolidayName("20250830")).toBeNull();
  });

  it("does not mark an earlier August Monday", () => {
    expect(getPresetHolidayName("20260824")).toBeNull();
  });
});
