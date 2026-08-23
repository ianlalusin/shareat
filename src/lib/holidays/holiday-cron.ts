// Pure scheduling helpers for the monthly per-store holiday calendar cron.
// All use UTC getters; the caller passes a Manila-shifted Date.

/**
 * Dedupe key for a cron run: `YYYY-MM`.
 *
 * Was `isoWeekKey` when this cron fired every 15 minutes and advanced one store
 * per fire. It now runs monthly and processes every due store in one fire, so
 * the key must be the month — a week key would reset between runs and make the
 * done-list permanently empty.
 */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Every store id not already processed this period. Ids in `doneStoreIds` that
 * are no longer active stores are simply ignored, so a deleted or
 * AI-disabled store can't wedge the list.
 */
export function pickDueStores(allStoreIds: string[], doneStoreIds: string[]): string[] {
  const done = new Set(doneStoreIds);
  return allStoreIds.filter((id) => !done.has(id));
}

/** A year doc big enough that a sudden collapse means something went wrong. */
const SUBSTANTIAL_YEAR = 10;

/**
 * Whether a freshly generated year is safe to publish over the stored one.
 *
 * The calendar used to be written with `merge: true`, which meant a wrong
 * entry could never be removed — Lipa carried "Araw ng Maynila" for weeks
 * because a regeneration could only add keys. It is now written wholesale so
 * corrections actually take, and this guard replaces the accidental protection
 * that merge was providing: a year is never blanked, and a substantial year is
 * never allowed to collapse to under half its size in one run.
 *
 * A modest shrink IS allowed — that is precisely what a correction looks like.
 */
export function decideCalendarWrite(
  currentCount: number | undefined,
  nextCount: number,
): { action: "write" | "skip"; reason: string } {
  const current = Number(currentCount) || 0;

  if (nextCount === 0 && current > 0) {
    return { action: "skip", reason: `generated 0 entries over a year holding ${current} — refusing to blank it` };
  }
  if (current >= SUBSTANTIAL_YEAR && nextCount < current / 2) {
    return {
      action: "skip",
      reason: `suspicious collapse ${current} -> ${nextCount} entries — refusing to publish`,
    };
  }
  return { action: "write", reason: `${current} -> ${nextCount} entries` };
}

/** Prior + current year (so last year's holidays seed learning); + next year in December. */
export function yearsToGenerate(now: Date): number[] {
  const y = now.getUTCFullYear();
  const years = [y - 1, y];
  if (now.getUTCMonth() === 11) years.push(y + 1);
  return years;
}
