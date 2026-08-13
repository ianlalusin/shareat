// src/lib/server/holiday-calendar.ts
import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { isStoreAiEnabled } from "@/lib/server/ai-enabled";
import { getActiveStores } from "@/lib/server/active-stores-cache";
import { generateHolidayCalendar } from "@/ai/flows/generate-holiday-calendar";
import { isoWeekKey, pickDueStore, yearsToGenerate } from "@/lib/holidays/holiday-cron";
import { recomputeHolidayEffectsForStore } from "@/lib/server/holiday-effects";
import type { HolidayCalendarEntry } from "@/lib/holidays/holiday-calendar";

const MODEL = "googleai/gemini-3.6-flash";
const HOLIDAY_CRON_LOG = "system/holidayCronLog";

/** One Gemini call → per-year `holidayCalendar/{YYYY}` docs (deep-merged). */
export async function generateAndStoreHolidayCalendar(
  store: { id: string; address?: string },
  years: number[],
): Promise<{ storeId: string; yearsWritten: number; entriesWritten: number }> {
  const db = getAdminDb();
  const locale = store.address?.trim() || "Philippines";

  const { entries } = await generateHolidayCalendar({ locale, years });

  const byYear = new Map<number, Record<string, HolidayCalendarEntry>>();
  for (const e of entries) {
    if (!/^\d{8}$/.test(e.dayId)) continue;
    const y = Number(e.dayId.slice(0, 4));
    if (!years.includes(y)) continue;
    if (!byYear.has(y)) byYear.set(y, {});
    byYear.get(y)![e.dayId] = {
      name: e.name, type: e.type, scope: e.scope, driver: e.driver, confidence: e.confidence,
    };
  }

  const batch = db.batch();
  let entriesWritten = 0;
  const now = Date.now();
  for (const [y, days] of byYear) {
    const ref = db.doc(`stores/${store.id}/holidayCalendar/${y}`);
    batch.set(
      ref,
      { year: y, storeId: store.id, locale, source: "ai", model: MODEL, generatedAtMs: now, days },
      { merge: true }, // deep-merges `days` so proclaimed dates append without dropping prior ones
    );
    entriesWritten += Object.keys(days).length;
  }
  await batch.commit();

  return { storeId: store.id, yearsWritten: byYear.size, entriesWritten };
}

async function markStoreDone(weekKey: string, storeId: string): Promise<void> {
  const db = getAdminDb();
  await db.doc(HOLIDAY_CRON_LOG).set(
    { weeks: { [weekKey]: { doneStoreIds: FieldValue.arrayUnion(storeId), lastFireAt: Timestamp.now() } } },
    { merge: true },
  );
}

/**
 * Process ONE store that hasn't been refreshed this ISO week. Generates its
 * calendar, recomputes its learned effects, and marks it done. Each cron fire
 * (every 15 min) advances one store, so every active AI store is refreshed ~weekly.
 */
export async function runHolidayCalendarForDueStore(): Promise<{
  skipped: boolean;
  reason: string;
  storeId?: string;
  result?: { storeId: string; yearsWritten: number; entriesWritten: number };
}> {
  const db = getAdminDb();
  const manila = new Date(Date.now() + 8 * 3600 * 1000);
  const weekKey = isoWeekKey(manila);

  const logSnap = await db.doc(HOLIDAY_CRON_LOG).get();
  const doneStoreIds: string[] = logSnap.exists
    ? (logSnap.data()?.weeks?.[weekKey]?.doneStoreIds ?? [])
    : [];

  const activeStores = await getActiveStores(db);
  const aiStoreIds: string[] = [];
  const storeById = new Map<string, { id: string; address?: string }>();
  for (const s of activeStores) {
    if (s.aiEnabled !== true) continue;
    aiStoreIds.push(s.id);
    storeById.set(s.id, { id: s.id, address: s.address ?? undefined });
  }

  const dueId = pickDueStore(aiStoreIds, doneStoreIds);
  if (!dueId) return { skipped: true, reason: `All ${aiStoreIds.length} AI store(s) done for ${weekKey}.` };

  // Honor the master AI switch; mark done so we don't retry it all week.
  if (!(await isStoreAiEnabled(db, dueId))) {
    await markStoreDone(weekKey, dueId);
    return { skipped: true, reason: `Store ${dueId} AI disabled; marked done.`, storeId: dueId };
  }

  const years = yearsToGenerate(manila);
  const result = await generateAndStoreHolidayCalendar(storeById.get(dueId)!, years);
  await recomputeHolidayEffectsForStore(dueId);
  await markStoreDone(weekKey, dueId);

  return { skipped: false, reason: `Generated holiday calendar for ${dueId} (${weekKey}).`, storeId: dueId, result };
}
