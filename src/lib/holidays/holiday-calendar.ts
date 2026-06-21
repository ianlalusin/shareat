// Pure helpers + types for the AI-generated per-store holiday calendar.
// No 'use server', no Firestore — safe to unit test and import anywhere.

export type HolidayType = "national" | "religious" | "commercial" | "fiesta" | "other";
export type HolidayScope = "national" | "local";
export type HolidayDriver = "up" | "down" | "neutral";

export type HolidayCalendarEntry = {
  name: string;
  type: HolidayType;
  scope: HolidayScope;
  driver: HolidayDriver;
  confidence: "high" | "medium" | "low";
};

export type HolidayCalendar = {
  year: number;
  storeId: string;
  locale: string;
  source: "ai";
  model: string;
  generatedAtMs: number;
  days: Record<string, HolidayCalendarEntry>; // key = dayId (YYYYMMDD)
};

export type UpcomingHoliday = { dayId: string; date: string; name: string; slug: string };

/** Stable slug used as the holidayEffects key. */
export function slugifyHoliday(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** YYYYMMDD -> YYYY-MM-DD */
export function dayIdToDate(dayId: string): string {
  return `${dayId.slice(0, 4)}-${dayId.slice(4, 6)}-${dayId.slice(6, 8)}`;
}

/**
 * Resolve which holidays fall inside an upcoming window. A dailyContext override
 * (manager edit) always wins over the AI calendar; an override of "None" clears
 * the day entirely.
 */
export function buildUpcomingHolidays(args: {
  calendarDays: Record<string, HolidayCalendarEntry>;
  overrides: Record<string, string | null>;
  windowDayIds: string[];
}): UpcomingHoliday[] {
  const { calendarDays, overrides, windowDayIds } = args;
  const out: UpcomingHoliday[] = [];
  for (const dayId of windowDayIds) {
    const override = overrides[dayId];
    let name: string | null = null;
    if (override !== undefined) {
      name = override && override !== "None" ? override : null; // override wins, incl. clear
    } else if (calendarDays[dayId]) {
      name = calendarDays[dayId].name;
    }
    if (name) out.push({ dayId, date: dayIdToDate(dayId), name, slug: slugifyHoliday(name) });
  }
  return out;
}
