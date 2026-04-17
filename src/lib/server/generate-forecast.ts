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

async function updateYesterdayAccuracy(storeId: string, now: Date): Promise<void> {
  const db = getAdminDb();
  const yesterday = subDays(now, 1);
  const yesterdayStr = format(yesterday, "yyyy-MM-dd");
  const yesterdayDayId = yesterdayStr.replace(/-/g, "");

  const forecastRef = db.doc(`stores/${storeId}/salesForecasts/${yesterdayStr}`);
  const forecastSnap = await forecastRef.get();
  if (!forecastSnap.exists) return;

  const forecastData = forecastSnap.data();
  if (!forecastData || forecastData.accuracy != null) return;

  const analyticsRef = db.doc(`stores/${storeId}/analytics/${yesterdayDayId}`);
  const analyticsSnap = await analyticsRef.get();
  if (!analyticsSnap.exists) return;

  const actualSales = analyticsSnap.data()?.payments?.totalGross ?? 0;
  if (actualSales <= 0) return;

  const projected = forecastData.projectedSales ?? 0;
  // Symmetric accuracy: |error| / max(actual, projected)
  // Gives identical scores for mirrored under/over-forecasts and is bounded [0,1].
  const denom = Math.max(actualSales, projected);
  const accuracy = denom > 0 ? 1 - Math.abs(actualSales - projected) / denom : 0;

  await forecastRef.update({
    actualSales,
    accuracy: Math.max(0, Math.min(1, accuracy)),
  });
}

export async function generateForecastForStore(store: StoreData): Promise<{ storeId: string; ok: boolean; error?: string; forecastsWritten?: number }> {
  const db = getAdminDb();
  const now = new Date();

  try {
    // 1. Update yesterday's accuracy
    await updateYesterdayAccuracy(store.id, now);

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

    const historicalWeather = weatherSnap.docs.map(d => {
      const data = d.data() as WeatherRecord;
      const conditions = data.entries.map(e => e.condition);
      const conditionCounts = conditions.reduce((acc, cond) => {
        acc[cond] = (acc[cond] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const summary = Object.keys(conditionCounts).sort((a, b) => conditionCounts[b] - conditionCounts[a])[0] || "clear";
      return {
        date: format(new Date(data.dayId.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")), "yyyy-MM-dd"),
        condition: summary.replace("_", " "),
      };
    });

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
        await updateYesterdayAccuracy(d.id, now);
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
