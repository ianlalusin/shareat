// Pure: turns raw per-store docs into the DayContext the model consumes.
import { slugifyHoliday } from "@/lib/holidays/holiday-calendar";
import type { HolidayEffect } from "@/lib/holidays/holiday-effects";
import type { DayContext } from "@/lib/forecast/model";
import { addDaysYmd, dowOf, paydayHitFor, type EffectivePayday } from "@/lib/forecast/payday";

export type LoggedWeatherDay = { condition?: string; am?: string; pm?: string; pop?: number | null };
export type ContextSources = {
  calendarNames: Record<string, string>;      // dayId -> holiday name (AI calendar)
  holidayOverrides: Record<string, string>;   // dayId -> name from dailyContext ("None" clears)
  staffPaydays: Set<string>;                  // dayIds with dailyContext.isPayday.value === true
  effects: Record<string, HolidayEffect>;     // holidayEffects/summary.effects, keyed by slug
  paydays: EffectivePayday[];
  weather: Record<string, LoggedWeatherDay>;  // weatherForecasts month docs' `days`, keyed by dayId
};

const RAIN = /rain|storm|thunder/i;
const HEAVY = /heavy|storm|thunder/i;

export const toDayId = (ymd: string) => ymd.replace(/-/g, "");

function pmText(w: LoggedWeatherDay): string {
  return String(w.pm ?? w.condition ?? "");
}

export function buildDayContext(date: string, src: ContextSources, mode: "learn" | "forecast"): DayContext {
  const id = toDayId(date);
  const ov = src.holidayOverrides[id];
  const name = ov !== undefined ? (ov && ov !== "None" ? ov : null) : (src.calendarNames[id] ?? null);
  const eff = name ? src.effects[slugifyHoliday(name)] : undefined;
  const w = src.weather[id];
  let rain = false;
  if (w && RAIN.test(pmText(w))) {
    rain = mode === "learn" || HEAVY.test(pmText(w)) || (w.pop ?? 0) >= 0.6;
  }
  return {
    date,
    dow: dowOf(date),
    holiday: name ? { name, liftPct: eff && eff.samples >= 1 ? eff.avgLiftPct : null } : null,
    rain,
    payday: paydayHitFor(date, src.paydays, src.staffPaydays.has(id)),
  };
}

/**
 * Dates the nightly learner should process, oldest first. Stops at the first
 * day with no analytics doc inside the last 2 days (probably not synced yet,
 * retried next night); older missing days are kept (closed → learned as 0).
 */
export function daysToLearn(
  processedThrough: string | null,
  today: string,
  hasSales: (ymd: string) => boolean,
  bootstrapDays = 90,
): string[] {
  const yesterday = addDaysYmd(today, -1);
  const recentCutoff = addDaysYmd(today, -2);
  const out: string[] = [];
  for (let d = processedThrough ? addDaysYmd(processedThrough, 1) : addDaysYmd(today, -bootstrapDays); d <= yesterday; d = addDaysYmd(d, 1)) {
    if (!hasSales(d) && d >= recentCutoff) break;
    out.push(d);
  }
  return out;
}
