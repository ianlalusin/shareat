// Fixed-date PH regular holidays. Variable-date holidays (Holy Week,
// Eid'l Fitr, etc.) are intentionally NOT here — the cashier/admin
// marks those via dailyContext when they roll around.
//
// Keyed by "MMDD" so this table works across years without maintenance.
export const PH_REGULAR_HOLIDAYS: Record<string, string> = {
  "0101": "New Year's Day",
  "0409": "Araw ng Kagitingan",
  "0501": "Labor Day",
  "0612": "Independence Day",
  "0821": "Ninoy Aquino Day",
  "1101": "All Saints' Day",
  "1130": "Bonifacio Day",
  "1225": "Christmas Day",
  "1230": "Rizal Day",
  "1231": "New Year's Eve",
};

/**
 * National Heroes Day is the LAST MONDAY of August, so it cannot live in the
 * MMDD table above.
 *
 * It used to, hardcoded as "0830", which was right only in the years where the
 * 30th happens to be the last Monday (2027 is one; 2026 is not — it falls on
 * the 31st). The weather calendar reads this table, so it has been marking the
 * wrong day. Computed here instead, which is exact for any year.
 */
function isNationalHeroesDay(year: number, month: number, day: number): boolean {
  if (month !== 8) return false;
  const date = new Date(Date.UTC(year, 7, day));
  if (date.getUTCDay() !== 1) return false; // not a Monday
  return day + 7 > 31; // no later Monday fits in August
}

/** Returns the preset PH-holiday name for a given dayId (YYYYMMDD), or null. */
export function getPresetHolidayName(dayId: string): string | null {
  if (dayId.length !== 8) return null;

  const year = Number(dayId.slice(0, 4));
  const month = Number(dayId.slice(4, 6));
  const day = Number(dayId.slice(6, 8));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  if (isNationalHeroesDay(year, month, day)) return "National Heroes Day";

  const mmdd = dayId.slice(4);
  return PH_REGULAR_HOLIDAYS[mmdd] ?? null;
}
