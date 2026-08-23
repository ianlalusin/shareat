import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

/**
 * A Manila calendar day, anchored at UTC midnight.
 *
 * The forecast generator derived every date from `new Date()` with date-fns
 * `format()` and `getDay()` — all server-local. The deployed runtime is UTC
 * (no `TZ` in apphosting.yaml) while analytics day docs are keyed to Manila, so
 * the two disagreed for the eight hours that matter. The cron fires 05:00–09:00
 * Manila, and the 05:00–07:00 fires sit on the previous UTC date: forecasts
 * were written for yesterday through day+5, the seventh forward day never
 * existed, and `subDays(now, 1)` dropped the freshest complete Manila day out
 * of the 28-day history window.
 *
 * Anchoring at UTC midnight (rather than at Manila midnight, which is 16:00Z
 * the day before) means `addDays`/`subDays` and the UTC getters below are exact
 * no matter what timezone the machine running this is set to — the dev boxes
 * here are UTC+8 and the server is UTC, and both must produce the same answer.
 *
 * The Manila calendar date itself comes from `getDayIdFromTimestamp`, the same
 * helper that keys the analytics docs, so a forecast day and an analytics day
 * can never mean different things.
 */
export function manilaDayAnchor(ts: number | Date = Date.now()): Date {
  const id = getDayIdFromTimestamp(ts);
  return new Date(`${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T00:00:00Z`);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` — the key shape used by `salesForecasts`. */
export function anchorYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `YYYYMMDD` — the key shape used by `analytics` and `dailyContext`. */
export function anchorDayId(d: Date): string {
  return anchorYmd(d).replace(/-/g, "");
}

/** Day of week, 0 = Sunday, in Manila terms. */
export function anchorDayOfWeek(d: Date): number {
  return d.getUTCDay();
}

/** Four-digit year, in Manila terms. */
export function anchorYear(d: Date): string {
  return String(d.getUTCFullYear());
}
