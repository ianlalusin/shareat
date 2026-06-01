import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { forecastWeeklySales, type ForecastInput } from "@/ai/flows/forecast-weekly-sales";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { format, addDays, subDays } from "date-fns";
import { getUpcomingPayrollDates, getUpcomingHolidays, computeDayOfWeekAverages, computeTrendDirection } from "@/lib/utils/forecast-helpers";
import type { DailyContext, ForecastConfig, WeatherRecord } from "@/lib/types";

type StoreData = {
  id: string;
  address?: string;
  isActive?: boolean;
  forecastConfig?: ForecastConfig;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Inclusive list of YYYY-MM month ids spanning two dates. */
function monthsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  const endY = end.getFullYear();
  const endM = end.getMonth();
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    if (++m > 11) { m = 0; y++; }
  }
  return out;
}

/**
 * Idempotently fills `accuracy` and `actualSales` for any forecast doc within
 * the last `days` days that is missing them. Self-healing: if a previous cron
 * run skipped, errored, or fired before yesterday's analytics doc was complete,
 * the next run picks it up automatically — no permanent gaps.
 *
 * Days are evaluated in reverse chronological order (most recent first) but
 * each is independent, so partial failures still make progress.
 */
async function backfillRecentAccuracy(storeId: string, now: Date, days = 7): Promise<void> {
  const db = getAdminDb();

  for (let i = 1; i <= days; i++) {
    const day = subDays(now, i);
    const dateStr = format(day, "yyyy-MM-dd");
    const dayId = dateStr.replace(/-/g, "");

    try {
      const forecastRef = db.doc(`stores/${storeId}/salesForecasts/${dateStr}`);
      const forecastSnap = await forecastRef.get();
      if (!forecastSnap.exists) continue;

      const forecastData = forecastSnap.data();
      if (!forecastData || forecastData.accuracy != null) continue;

      const analyticsRef = db.doc(`stores/${storeId}/analytics/${dayId}`);
      const analyticsSnap = await analyticsRef.get();
      if (!analyticsSnap.exists) continue;

      const actualSales = analyticsSnap.data()?.payments?.totalGross ?? 0;
      if (actualSales <= 0) continue;

      const projected = forecastData.projectedSales ?? 0;
      // Symmetric accuracy: |error| / max(actual, projected)
      // Gives identical scores for mirrored under/over-forecasts and is bounded [0,1].
      const denom = Math.max(actualSales, projected);
      const accuracy = denom > 0 ? 1 - Math.abs(actualSales - projected) / denom : 0;

      await forecastRef.update({
        actualSales,
        accuracy: Math.max(0, Math.min(1, accuracy)),
      });
    } catch (err) {
      console.error(`[backfillRecentAccuracy] store=${storeId} date=${dateStr} failed:`, err);
      // continue on next day — never let one bad day block the rest
    }
  }
}

export async function generateForecastForStore(store: StoreData): Promise<{ storeId: string; ok: boolean; error?: string; forecastsWritten?: number }> {
  const db = getAdminDb();
  const now = new Date();

  try {
    // 1. Backfill accuracy for the last 7 days (idempotent, self-healing).
    await backfillRecentAccuracy(store.id, now, 7);

    // 2. Fetch 28 days of data
    const historyEndDate = subDays(now, 1);
    const historyStartDate = subDays(historyEndDate, 27);
    const startDayId = format(historyStartDate, "yyyyMMdd");
    const endDayId = format(historyEndDate, "yyyyMMdd");
    const todayDayId = format(now, "yyyyMMdd");

    const [salesSnap, weatherSnap, dailyContextSnap] = await Promise.all([
      db.collection(`stores/${store.id}/analytics`)
        .where("meta.dayStartMs", ">=", historyStartDate.getTime())
        .where("meta.dayStartMs", "<=", historyEndDate.getTime())
        .orderBy("meta.dayStartMs", "desc")
        .get(),
      db.collection(`stores/${store.id}/weatherRecords`)
        .where("dayId", ">=", startDayId)
        .where("dayId", "<=", endDayId)
        .get(),
      db.collection(`stores/${store.id}/dailyContext`)
        .where("dayId", ">=", startDayId)
        .where("dayId", "<=", todayDayId)
        .get(),
    ]);

    const historicalSales = salesSnap.docs.map(d => {
      const data = d.data();
      return {
        date: format(new Date(data.meta.dayStartMs!), "yyyy-MM-dd"),
        netSales: data.payments?.totalGross ?? 0,
      };
    });

    if (historicalSales.length < 7) {
      return { storeId: store.id, ok: false, error: "Not enough history (need ≥7 days)" };
    }

    // Weather now lives primarily in monthly weatherForecasts docs (API-logged).
    // Read the months covering the history window + the next 7 days, then build
    // both the historical series and the upcoming forecast from them; fall back
    // to legacy per-day weatherRecords for any day the API hasn't covered.
    const monthIds = monthsBetween(historyStartDate, addDays(now, 7));
    const wfSnaps = await Promise.all(
      monthIds.map((ym) => db.doc(`stores/${store.id}/weatherForecasts/${ym}`).get()),
    );
    const wfDays: Record<string, { date: string; condition: string }> = {};
    for (const s of wfSnaps) {
      if (!s.exists) continue;
      const days = (s.data()?.days ?? {}) as Record<string, any>;
      for (const id of Object.keys(days)) {
        wfDays[id] = { date: days[id].date, condition: String(days[id].condition).replace("_", " ") };
      }
    }

    const todayDate = format(now, "yyyy-MM-dd");
    const histByDate = new Map<string, string>();
    // Legacy weatherRecords (fallback so pre-existing manual history still counts).
    weatherSnap.docs.forEach((d) => {
      const data = d.data() as WeatherRecord;
      const counts = data.entries.reduce((acc, e) => { acc[e.condition] = (acc[e.condition] || 0) + 1; return acc; }, {} as Record<string, number>);
      const summary = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "clear";
      const date = format(new Date(data.dayId.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")), "yyyy-MM-dd");
      histByDate.set(date, summary.replace("_", " "));
    });
    // API-logged days override for any past day they cover.
    for (const id of Object.keys(wfDays)) {
      if (wfDays[id].date < todayDate) histByDate.set(wfDays[id].date, wfDays[id].condition);
    }
    const historicalWeather = [...histByDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, condition]) => ({ date, condition }));

    // Upcoming forecast for the next 7 days (from the API-logged monthly docs).
    const forecastWeather: { date: string; condition: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const id = format(addDays(now, i), "yyyyMMdd");
      if (wfDays[id]) forecastWeather.push({ date: wfDays[id].date, condition: wfDays[id].condition });
    }

    const dailyContextDocs = dailyContextSnap.docs.map(d => d.data() as DailyContext);
    const loggedHolidays = dailyContextDocs
      .filter(dc => dc.holiday && dc.holiday.name !== "None")
      .map(dc => {
        const dateStr = dc.dayId.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
        return `${dc.holiday!.name} on ${dateStr}`;
      });
    const todayContext = dailyContextDocs.find(dc => dc.dayId === todayDayId);

    const config = store.forecastConfig;
    const upcomingPayrollDates = getUpcomingPayrollDates(config);
    const configHolidays = getUpcomingHolidays(config).map(h => `${h.name} on ${h.date}`);
    const upcomingHolidays = [...new Set([...configHolidays, ...loggedHolidays])];
    const dayOfWeekAverages = computeDayOfWeekAverages(historicalSales);
    const { direction: trendDirection, ratio: recentVsHistoricalRatio } = computeTrendDirection(historicalSales);

    const forecastInput: ForecastInput = {
      historicalSales,
      historicalWeather,
      forecastWeather,
      storeLocation: store.address ?? "",
      upcomingPayrollDates,
      upcomingHolidays,
      dayOfWeekAverages,
      trendDirection,
      recentVsHistoricalRatio,
      storeContext: [
        config?.storeContext,
        todayContext?.isPayday?.value ? "Today is confirmed as a payday by staff." : undefined,
        todayContext?.holiday && todayContext.holiday.name !== "None"
          ? `Today is ${todayContext.holiday.name} (confirmed by staff).`
          : undefined,
      ].filter(Boolean).join(" ") || undefined,
    };

    // 3. Call Gemini
    const result = await forecastWeeklySales(forecastInput);

    // 4. Write forecasts for next 7 days
    const batch = db.batch();
    const todayDayIndex = now.getDay();
    let writtenCount = 0;

    for (const daily of result.forecast) {
      const forecastDayIndex = DAY_NAMES.indexOf(daily.day);
      if (forecastDayIndex === -1) continue;

      let dayDiff = forecastDayIndex - todayDayIndex;
      if (dayDiff < 0) dayDiff += 7;

      const forecastDate = addDays(now, dayDiff);
      const forecastDateStr = format(forecastDate, "yyyy-MM-dd");

      const docRef = db.doc(`stores/${store.id}/salesForecasts/${forecastDateStr}`);
      batch.set(docRef, {
        date: forecastDateStr,
        projectedSales: daily.forecastedSales,
        confidence: daily.confidence ?? null,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      writtenCount++;
    }

    await batch.commit();
    return { storeId: store.id, ok: true, forecastsWritten: writtenCount };
  } catch (err: any) {
    console.error(`[generateForecastForStore] store=${store.id} failed:`, err);
    return { storeId: store.id, ok: false, error: err.message || String(err) };
  }
}

export async function generateForecastsForAllActiveStores(): Promise<{
  totalStores: number;
  results: { storeId: string; ok: boolean; error?: string; forecastsWritten?: number }[];
}> {
  const db = getAdminDb();
  const storesSnap = await db.collection("stores").where("isActive", "==", true).get();

  const stores: StoreData[] = storesSnap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      address: data.address,
      isActive: data.isActive,
      forecastConfig: data.forecastConfig,
    };
  });

  const results = await Promise.all(stores.map(generateForecastForStore));
  return { totalStores: stores.length, results };
}

/* ------------------------------------------------------------------ */
/*  Standalone accuracy update (decoupled from forecast generation)   */
/* ------------------------------------------------------------------ */

export async function updateAccuracyForAllActiveStores(): Promise<{
  totalStores: number;
  results: { storeId: string; ok: boolean; error?: string }[];
}> {
  const db = getAdminDb();
  const storesSnap = await db.collection("stores").where("isActive", "==", true).get();
  const now = new Date();

  const results = await Promise.all(
    storesSnap.docs.map(async (d) => {
      try {
        await backfillRecentAccuracy(d.id, now, 7);
        return { storeId: d.id, ok: true };
      } catch (err: any) {
        console.error(`[updateAccuracy] store=${d.id} failed:`, err);
        return { storeId: d.id, ok: false, error: err.message || String(err) };
      }
    }),
  );

  return { totalStores: storesSnap.size, results };
}

/* ------------------------------------------------------------------ */
/*  Cron run-log helpers  (retry-on-failure tracking)                 */
/* ------------------------------------------------------------------ */

/** Returns today's date string in Asia/Manila timezone (YYYY-MM-DD). */
function getManilaDateStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date());
}

type DayRunLog = {
  status: "success" | "failed";
  attempts: number;
  lastAttemptAt: Timestamp;
  successAt: Timestamp | null;
};

const CRON_LOG_DOC = "system/forecastCronLog";

async function getTodayRunLog(dateStr: string): Promise<DayRunLog | null> {
  const db = getAdminDb();
  const doc = await db.doc(CRON_LOG_DOC).get();
  if (!doc.exists) return null;
  const runs = doc.data()?.runs ?? {};
  return runs[dateStr] ?? null;
}

async function writeDayRunLog(dateStr: string, log: DayRunLog): Promise<void> {
  const db = getAdminDb();
  await db.doc(CRON_LOG_DOC).set({ runs: { [dateStr]: log } }, { merge: true });
}

const MAX_DAILY_ATTEMPTS = 5;

export async function shouldRunForecast(): Promise<{
  shouldRun: boolean;
  reason: string;
  currentLog: DayRunLog | null;
}> {
  const dateStr = getManilaDateStr();
  const log = await getTodayRunLog(dateStr);

  if (!log) return { shouldRun: true, reason: "No runs today yet.", currentLog: null };
  if (log.status === "success") return { shouldRun: false, reason: "Already succeeded today.", currentLog: log };
  if (log.attempts >= MAX_DAILY_ATTEMPTS) return { shouldRun: false, reason: `Max ${MAX_DAILY_ATTEMPTS} failed attempts reached.`, currentLog: log };
  return { shouldRun: true, reason: `Retrying after ${log.attempts} failed attempt(s).`, currentLog: log };
}

export async function runForecastWithTracking(): Promise<{
  skipped: boolean;
  reason: string;
  result?: Awaited<ReturnType<typeof generateForecastsForAllActiveStores>>;
}> {
  const { shouldRun, reason, currentLog } = await shouldRunForecast();
  if (!shouldRun) return { skipped: true, reason };

  const dateStr = getManilaDateStr();
  const attempts = (currentLog?.attempts ?? 0) + 1;

  try {
    const result = await generateForecastsForAllActiveStores();
    const allOk = result.results.every((r) => r.ok);

    await writeDayRunLog(dateStr, {
      status: allOk ? "success" : "failed",
      attempts,
      lastAttemptAt: Timestamp.now(),
      successAt: allOk ? Timestamp.now() : null,
    });

    return {
      skipped: false,
      reason: allOk ? "Forecast succeeded." : "Forecast partially failed.",
      result,
    };
  } catch (err) {
    await writeDayRunLog(dateStr, {
      status: "failed",
      attempts,
      lastAttemptAt: Timestamp.now(),
      successAt: null,
    });
    throw err;
  }
}
