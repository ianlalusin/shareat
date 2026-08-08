// src/lib/server/holiday-effects.ts
import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { computeHolidayEffects, type LabeledHolidayDay } from "@/lib/holidays/holiday-effects";
import { dayIdToDate } from "@/lib/holidays/holiday-calendar";

const MAX_LOOKBACK_DAYS = 731;
const BASELINE_PAD_DAYS = 29;

/**
 * Recompute and persist this store's learned holiday lifts from its AI calendar(s)
 * + dailyContext overrides + analytics sales. Deterministic, no AI call.
 */
export async function recomputeHolidayEffectsForStore(
  storeId: string,
): Promise<{ ok: boolean; effectsCount: number }> {
  const db = getAdminDb();

  // Manila "today" (UTC getters on a +8h-shifted clock).
  const manila = new Date(Date.now() + 8 * 3600 * 1000);
  const todayId = `${manila.getUTCFullYear()}${String(manila.getUTCMonth() + 1).padStart(2, "0")}${String(manila.getUTCDate()).padStart(2, "0")}`;

  // 1. Calendar entries across all stored years: dayId -> name.
  const calSnap = await db.collection(`stores/${storeId}/holidayCalendar`).get();
  const calDays: Record<string, string> = {};
  for (const d of calSnap.docs) {
    const days = (d.data()?.days ?? {}) as Record<string, { name: string }>;
    for (const id of Object.keys(days)) calDays[id] = days[id].name;
  }

  // 2. dailyContext overrides: dayId -> name (incl. "None").
  const dcSnap = await db.collection(`stores/${storeId}/dailyContext`).get();
  const overrides: Record<string, string> = {};
  for (const d of dcSnap.docs) {
    const h = d.data()?.holiday;
    if (h && typeof h.name === "string") overrides[d.id] = h.name;
  }

  // 3. Labeled PAST days (override wins; "None" clears).
  const labeled: LabeledHolidayDay[] = [];
  const allDayIds = new Set<string>([...Object.keys(calDays), ...Object.keys(overrides)]);
  for (const dayId of allDayIds) {
    if (dayId >= todayId) continue; // past only
    const ov = overrides[dayId];
    let name: string | null;
    if (ov !== undefined) name = ov && ov !== "None" ? ov : null;
    else name = calDays[dayId] ?? null;
    if (name) labeled.push({ date: dayIdToDate(dayId), name });
  }

  const summaryRef = db.doc(`stores/${storeId}/holidayEffects/summary`);
  if (labeled.length === 0) {
    await summaryRef.set({ storeId, updatedAtMs: Date.now(), effects: {} });
    return { ok: true, effectsCount: 0 };
  }

  // 4. Sales by date over a bounded range (range filter by dayStartMs; KEY by doc id).
  const earliest = labeled.map((l) => l.date).sort()[0];
  const earliestMs = Date.parse(`${earliest}T00:00:00Z`) - BASELINE_PAD_DAYS * 86400000;
  const floorMs = Date.now() - MAX_LOOKBACK_DAYS * 86400000;
  const lowerMs = Math.max(earliestMs, floorMs);

  const anSnap = await db
    .collection(`stores/${storeId}/analytics`)
    .where("meta.dayStartMs", ">=", lowerMs)
    .orderBy("meta.dayStartMs", "asc")
    .get();

  const salesByDate: Record<string, number> = {};
  for (const d of anSnap.docs) {
    salesByDate[dayIdToDate(d.id)] = d.data()?.payments?.totalGross ?? 0; // doc id = Manila dayId
  }

  const effects = computeHolidayEffects(labeled, salesByDate);
  await summaryRef.set({ storeId, updatedAtMs: Date.now(), effects });
  return { ok: true, effectsCount: Object.keys(effects).length };
}
