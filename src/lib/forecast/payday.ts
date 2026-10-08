// Pure — no Firestore, no Date getters in local time. Dates are Manila calendar
// days as YYYY-MM-DD; all maths is on UTC midnights of those strings.
import type { ForecastConfig } from "@/lib/types";

export type EffectivePayday = { date: string; nominal: string; shifted: boolean };
export type PaydayOffset = -1 | 0 | 1 | 2;
export type PaydayClass = "fri" | "wkday";
export type PaydayHit = { offset: PaydayOffset; cls: PaydayClass; shiftedFrom: string | null; payday: string };

const DAY_MS = 86_400_000;

export function ymdToMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`);
}
function msToYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDaysYmd(ymd: string, n: number): string {
  return msToYmd(ymdToMs(ymd) + n * DAY_MS);
}
export function dowOf(ymd: string): number {
  return new Date(ymdToMs(ymd)).getUTCDay();
}

/** Days of the month that are paydays, or null when the payday factor does not apply. */
export function paydayDaysOfMonth(config?: ForecastConfig): number[] | null {
  const type = config?.payrollScheduleType ?? "semi_monthly_15_eom";
  // Weekly/bi-weekly: every (other) Friday is payday — indistinguishable from
  // the Friday weekday baseline, so the factor is off.
  if (type === "weekly" || type === "bi_weekly") return null;
  // Blank custom dates → same [15, 31] default the LLM path uses (forecast-helpers).
  if (type === "custom") return config?.customPayrollDates?.length ? [...config.customPayrollDates] : [15, 31];
  return [15, 31];
}

/**
 * Effective paydays touching [fromYmd, toYmd], padded one month each side so
 * offsets −1..+2 near a month edge still resolve. A day-of-month past the
 * month's end clamps to the last day (31 = EOM); a Sat/Sun payday moves to
 * the preceding Friday (salary released early).
 */
export function effectivePaydays(daysOfMonth: number[], fromYmd: string, toYmd: string): EffectivePayday[] {
  const out = new Map<string, EffectivePayday>();
  const [fy, fm] = fromYmd.split("-").map(Number);
  const [ty, tm] = toYmd.split("-").map(Number);
  // idx = year*12 + zero-based month; fm/tm are 1-based.
  for (let idx = fy * 12 + fm - 2; idx <= ty * 12 + tm; idx++) {
    const y = Math.floor(idx / 12);
    const m = idx % 12;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (const dom of daysOfMonth) {
      if (!Number.isInteger(dom) || dom < 1 || dom > 31) continue;
      const nominal = msToYmd(Date.UTC(y, m, Math.min(dom, lastDay)));
      const dow = dowOf(nominal);
      const back = dow === 6 ? 1 : dow === 0 ? 2 : 0;
      const date = addDaysYmd(nominal, -back);
      if (!out.has(date)) out.set(date, { date, nominal, shifted: back > 0 });
    }
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Which payday window (if any) a date falls in. Nearest payday wins; ties go to the one already passed. */
export function paydayHitFor(date: string, paydays: EffectivePayday[], staffConfirmed = false): PaydayHit | null {
  let best: PaydayHit | null = null;
  const t = ymdToMs(date);
  for (const p of paydays) {
    const off = Math.round((t - ymdToMs(p.date)) / DAY_MS);
    if (off < -1 || off > 2) continue;
    if (best) {
      const closer = Math.abs(off) < Math.abs(best.offset);
      const tieButLater = Math.abs(off) === Math.abs(best.offset) && off > best.offset;
      if (!closer && !tieButLater) continue;
    }
    best = { offset: off as PaydayOffset, cls: dowOf(p.date) === 5 ? "fri" : "wkday", shiftedFrom: p.shifted ? p.nominal : null, payday: p.date };
  }
  if (!best && staffConfirmed) {
    best = { offset: 0, cls: dowOf(date) === 5 ? "fri" : "wkday", shiftedFrom: null, payday: date };
  }
  return best;
}
