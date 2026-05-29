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
  "0830": "National Heroes Day",
  "1101": "All Saints' Day",
  "1130": "Bonifacio Day",
  "1225": "Christmas Day",
  "1230": "Rizal Day",
  "1231": "New Year's Eve",
};

/** Returns the preset PH-holiday name for a given dayId (YYYYMMDD), or null. */
export function getPresetHolidayName(dayId: string): string | null {
  if (dayId.length !== 8) return null;
  const mmdd = dayId.slice(4);
  return PH_REGULAR_HOLIDAYS[mmdd] ?? null;
}
