// src/lib/server/holiday-calendar.ts
import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { isStoreAiEnabled } from "@/lib/server/ai-enabled";
import { getActiveStores } from "@/lib/server/active-stores-cache";
import { generateHolidayCalendar } from "@/ai/flows/generate-holiday-calendar";
import { monthKey, pickDueStores, yearsToGenerate } from "@/lib/holidays/holiday-cron";
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

async function markStoreDone(periodKey: string, storeId: string): Promise<void> {
  const db = getAdminDb();
  await db.doc(HOLIDAY_CRON_LOG).set(
    { months: { [periodKey]: { doneStoreIds: FieldValue.arrayUnion(storeId), lastFireAt: Timestamp.now() } } },
    { merge: true },
  );
}

/**
 * Refresh the holiday calendar for every AI-enabled store that has not been
 * done this calendar month, in a single fire.
 *
 * Previously this processed ONE store per fire, deduped by ISO week, because it
 * ran every 15 minutes. On a monthly schedule that design silently breaks: each
 * fire lands in a different ISO week, so the done-list is always empty and the
 * picker always returns the first store — store #1 would be refreshed forever
 * and every other store never, while the route still returned 200 OK. Hence
 * both changes together: month-keyed dedupe, and all due stores per fire.
 *
 * Stores are processed sequentially (one Gemini call each) and isolated by
 * try/catch, so one failing store cannot abort the rest. Because each store is
 * marked done only after it succeeds, a timeout or partial failure can simply
 * be retried within the same month and will pick up only the stragglers.
 */
export async function runHolidayCalendarForAllDueStores(): Promise<{
  periodKey: string;
  totalAiStores: number;
  processed: number;
  skipped: number;
  failed: number;
  results: Array<{
    storeId: string;
    status: "generated" | "skipped" | "failed";
    reason?: string;
    yearsWritten?: number;
    entriesWritten?: number;
  }>;
}> {
  const db = getAdminDb();
  const manila = new Date(Date.now() + 8 * 3600 * 1000);
  const periodKey = monthKey(manila);
  const years = yearsToGenerate(manila);

  const logSnap = await db.doc(HOLIDAY_CRON_LOG).get();
  const doneStoreIds: string[] = logSnap.exists
    ? (logSnap.data()?.months?.[periodKey]?.doneStoreIds ?? [])
    : [];

  const activeStores = await getActiveStores(db);
  const aiStoreIds: string[] = [];
  const storeById = new Map<string, { id: string; address?: string }>();
  for (const s of activeStores) {
    if (s.aiEnabled !== true) continue;
    aiStoreIds.push(s.id);
    storeById.set(s.id, { id: s.id, address: s.address ?? undefined });
  }

  const due = pickDueStores(aiStoreIds, doneStoreIds);
  const results: Array<{
    storeId: string;
    status: "generated" | "skipped" | "failed";
    reason?: string;
    yearsWritten?: number;
    entriesWritten?: number;
  }> = [];

  for (const storeId of due) {
    try {
      // Honor the master AI switch; mark done so we don't retry it all month.
      if (!(await isStoreAiEnabled(db, storeId))) {
        await markStoreDone(periodKey, storeId);
        results.push({ storeId, status: "skipped", reason: "AI disabled" });
        continue;
      }

      const result = await generateAndStoreHolidayCalendar(storeById.get(storeId)!, years);
      await recomputeHolidayEffectsForStore(storeId);
      await markStoreDone(periodKey, storeId);
      results.push({
        storeId,
        status: "generated",
        yearsWritten: result.yearsWritten,
        entriesWritten: result.entriesWritten,
      });
    } catch (err: any) {
      // Deliberately NOT marked done — a failed store is retried on the next
      // fire within the same month rather than being written off.
      console.error(`[holiday-calendar] store ${storeId} failed:`, err);
      results.push({ storeId, status: "failed", reason: err?.message ?? "unknown error" });
    }
  }

  return {
    periodKey,
    totalAiStores: aiStoreIds.length,
    processed: results.filter((r) => r.status === "generated").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
