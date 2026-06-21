// Deterministic per-store holiday-lift learning. Pure — no Firestore, no AI.

import { slugifyHoliday, type UpcomingHoliday } from "@/lib/holidays/holiday-calendar";

export type HolidayOccurrence = { date: string; liftPct: number; baseline: number; actual: number };
export type HolidayEffect = {
  name: string;
  slug: string;
  avgLiftPct: number;   // EWMA across occurrences
  samples: number;
  lastDate: string;     // YYYY-MM-DD
  occurrences: HolidayOccurrence[]; // last MAX_OCCURRENCES, oldest→newest
};
export type HolidayEffectsSummary = {
  storeId: string;
  updatedAtMs: number;
  effects: Record<string, HolidayEffect>;
};
export type LabeledHolidayDay = { date: string; name: string }; // date = YYYY-MM-DD

const BASELINE_WINDOW_DAYS = 28;
const MIN_BASELINE_SAMPLES = 2;
const EWMA_ALPHA = 0.5;
const MAX_OCCURRENCES = 5;
const MIN_SAMPLES_FOR_NUMBER = 1;

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
function weekdayName(dateStr: string): string {
  return DOW[dayOfWeek(dateStr)];
}
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/**
 * Baseline for a holiday day = mean net sales of the SAME weekday within
 * ±BASELINE_WINDOW_DAYS, excluding holiday days and zero/closed days.
 * Returns null when fewer than MIN_BASELINE_SAMPLES qualifying days.
 */
export function computeBaseline(
  targetDate: string,
  salesByDate: Record<string, number>,
  holidayDates: Set<string>,
): number | null {
  const targetDow = dayOfWeek(targetDate);
  const samples: number[] = [];
  for (const [date, sales] of Object.entries(salesByDate)) {
    if (date === targetDate) continue;
    if (sales <= 0) continue;
    if (holidayDates.has(date)) continue;
    if (dayOfWeek(date) !== targetDow) continue;
    if (Math.abs(daysBetween(date, targetDate)) > BASELINE_WINDOW_DAYS) continue;
    samples.push(sales);
  }
  if (samples.length < MIN_BASELINE_SAMPLES) return null;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/** Per-holiday learned lift from labeled past days + actual sales. */
export function computeHolidayEffects(
  labeled: LabeledHolidayDay[],
  salesByDate: Record<string, number>,
): Record<string, HolidayEffect> {
  const holidayDates = new Set(labeled.map((l) => l.date));
  const bySlug = new Map<string, { name: string; occ: HolidayOccurrence[] }>();

  const sorted = [...labeled].sort((a, b) => a.date.localeCompare(b.date)); // oldest→newest
  for (const { date, name } of sorted) {
    const actual = salesByDate[date];
    if (actual == null || actual <= 0) continue;
    const baseline = computeBaseline(date, salesByDate, holidayDates);
    if (baseline == null || baseline <= 0) continue;
    const liftPct = Math.round((actual / baseline - 1) * 100);
    const slug = slugifyHoliday(name);
    if (!bySlug.has(slug)) bySlug.set(slug, { name, occ: [] });
    bySlug.get(slug)!.occ.push({ date, liftPct, baseline: Math.round(baseline), actual: Math.round(actual) });
  }

  const effects: Record<string, HolidayEffect> = {};
  for (const [slug, { name, occ }] of bySlug) {
    if (occ.length === 0) continue;
    let ewma = occ[0].liftPct;
    for (let i = 1; i < occ.length; i++) ewma = EWMA_ALPHA * occ[i].liftPct + (1 - EWMA_ALPHA) * ewma;
    effects[slug] = {
      name,
      slug,
      avgLiftPct: Math.round(ewma),
      samples: occ.length,
      lastDate: occ[occ.length - 1].date,
      occurrences: occ.slice(-MAX_OCCURRENCES),
    };
  }
  return effects;
}

/** Build the holiday context strings handed to the forecast model. */
export function enrichUpcomingHolidays(
  upcoming: UpcomingHoliday[],
  effects: Record<string, HolidayEffect>,
): string[] {
  return upcoming.map((h) => {
    const eff = effects[h.slug];
    if (eff && eff.samples >= MIN_SAMPLES_FOR_NUMBER) {
      const dir = eff.avgLiftPct >= 0 ? `+${eff.avgLiftPct}%` : `${eff.avgLiftPct}%`;
      const occ = eff.samples === 1 ? "1 past occasion" : `${eff.samples} past occasions`;
      return `${h.name} on ${h.date} — historically ${dir} vs a normal ${weekdayName(h.date)} at this branch (${occ}).`;
    }
    return `${h.name} on ${h.date} — no measured history yet at this branch; use judgment.`;
  });
}
