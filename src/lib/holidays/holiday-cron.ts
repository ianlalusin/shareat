// Pure scheduling helpers for the weekly per-store holiday calendar cron.
// All use UTC getters; the caller passes a Manila-shifted Date.

export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;          // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);  // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** First store id not present in doneStoreIds, or null when all are done. */
export function pickDueStore(allStoreIds: string[], doneStoreIds: string[]): string | null {
  const done = new Set(doneStoreIds);
  for (const id of allStoreIds) if (!done.has(id)) return id;
  return null;
}

/** Prior + current year (so last year's holidays seed learning); + next year in December. */
export function yearsToGenerate(now: Date): number[] {
  const y = now.getUTCFullYear();
  const years = [y - 1, y];
  if (now.getUTCMonth() === 11) years.push(y + 1);
  return years;
}
