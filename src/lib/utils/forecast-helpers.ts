import { format, addDays } from "date-fns";
import type { ForecastConfig } from "@/lib/types";
import { addDaysYmd, effectivePaydays, paydayDaysOfMonth } from "@/lib/forecast/payday";
import { anchorYmd, manilaDayAnchor } from "@/lib/analytics/manila-day";

function atStartOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Helper to find e.g., the 2nd Sunday of a month
function getNthDayOfMonth(n: number, day: number, month: number, year: number) {
  const d = new Date(year, month, 1);
  let count = 0;
  while (count < n) {
    if (d.getDay() === day) {
      count++;
      if (count === n) break;
    }
    d.setDate(d.getDate() + 1);
  }
  return d;
}

// --- Default Philippine holidays (fallback when no custom holidays configured) ---
const DEFAULT_HOLIDAYS = (year: number): { name: string; date: Date }[] => [
  { name: "New Year's Day", date: new Date(year, 0, 1) },
  { name: "Valentine's Day", date: new Date(year, 1, 14) },
  { name: "Mother's Day", date: getNthDayOfMonth(2, 0, 4, year) },
  { name: "Father's Day", date: getNthDayOfMonth(3, 0, 5, year) },
  { name: "Christmas Day", date: new Date(year, 11, 25) },
  { name: "New Year's Eve", date: new Date(year, 11, 31) },
];

export function getUpcomingPayrollDates(config?: ForecastConfig, nowMs: number = Date.now()): string[] {
  const type = config?.payrollScheduleType ?? "semi_monthly_15_eom";
  if (type === "weekly" || type === "bi_weekly") {
    const today = atStartOfDay(new Date(nowMs));
    const dates: Date[] = [];
    const weekday = config?.payrollWeekday ?? 5; // default Friday
    const stepDays = type === "bi_weekly" ? 14 : 7;
    const d = new Date(today);
    while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
    for (let i = 0; i < 8; i++) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + stepDays);
    }
    return dates.map((date) => format(date, "yyyy-MM-dd"));
  }
  // Day-of-month schedules: Manila calendar maths on strings (no server-local
  // Date getters), 31 clamps to month end, Sat/Sun pay moves to Friday.
  const dom = paydayDaysOfMonth(config) ?? [15, 31];
  const today = anchorYmd(manilaDayAnchor(nowMs));
  return effectivePaydays(dom, today, addDaysYmd(today, 75))
    .map((p) => p.date)
    .filter((d) => d >= today);
}

export function getUpcomingHolidays(config?: ForecastConfig): { name: string; date: string }[] {
  const today = atStartOfDay(new Date());
  const year = today.getFullYear();

  if (config?.customHolidays?.length) {
    return config.customHolidays
      .filter((h) => new Date(h.date) >= today)
      .map((h) => ({ name: h.name, date: h.date }));
  }

  // Fallback to default Philippine holidays
  return DEFAULT_HOLIDAYS(year)
    .filter((h) => h.date >= today)
    .map((h) => ({ name: h.name, date: format(h.date, "yyyy-MM-dd") }));
}

export function computeDayOfWeekAverages(
  historicalSales: { date: string; netSales: number }[]
): { day: string; averageSales: number }[] {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const buckets: Record<string, number[]> = {};
  for (const name of dayNames) buckets[name] = [];

  for (const s of historicalSales) {
    const d = new Date(s.date);
    if (!isNaN(d.getTime())) {
      buckets[dayNames[d.getDay()]].push(s.netSales);
    }
  }

  return dayNames.map((day) => ({
    day,
    averageSales:
      buckets[day].length > 0
        ? Math.round(buckets[day].reduce((a, b) => a + b, 0) / buckets[day].length)
        : 0,
  }));
}

export function computeTrendDirection(
  historicalSales: { date: string; netSales: number }[]
): { direction: "up" | "down" | "flat"; ratio: number } {
  if (historicalSales.length < 14) return { direction: "flat", ratio: 1 };

  const sorted = [...historicalSales].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const recent = sorted.slice(-7);
  const prior = sorted.slice(-14, -7);

  const recentAvg = recent.reduce((s, r) => s + r.netSales, 0) / recent.length;
  const priorAvg = prior.reduce((s, r) => s + r.netSales, 0) / prior.length;

  if (priorAvg === 0) return { direction: "flat", ratio: 1 };

  const ratio = Math.round((recentAvg / priorAvg) * 100) / 100;
  const direction = ratio > 1.05 ? "up" : ratio < 0.95 ? "down" : "flat";

  return { direction, ratio };
}

export function buildForecastConfig(input: {
  holidays: { name: string; date: string }[];
  payrollDatesText: string;
  storeContext: string;
  engine: "llm" | "model";
}): ForecastConfig {
  const customPayrollDates = input.payrollDatesText
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n >= 1 && n <= 31);
  return {
    customHolidays: input.holidays,
    payrollScheduleType: "custom",
    customPayrollDates,
    storeContext: input.storeContext.trim().slice(0, 500),
    engine: input.engine,
  };
}
