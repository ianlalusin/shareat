import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { isStoreAiEnabled } from "@/lib/server/ai-enabled";
import { getActiveStores } from "@/lib/server/active-stores-cache";
import { forecastWeeklySales, type ForecastInput } from "@/ai/flows/forecast-weekly-sales";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { addDays, subDays } from "date-fns";
import { manilaDayAnchor, anchorYmd, anchorDayId, anchorDayOfWeek, anchorYear } from "@/lib/analytics/manila-day";
import { getUpcomingPayrollDates, getUpcomingHolidays, computeDayOfWeekAverages, computeTrendDirection } from "@/lib/utils/forecast-helpers";
import { buildUpcomingHolidays, type HolidayCalendarEntry } from "@/lib/holidays/holiday-calendar";
import { enrichUpcomingHolidays } from "@/lib/holidays/holiday-effects";
import { learnForecastModel } from "@/lib/server/forecast-model";
import type { DailyContext, ForecastConfig, WeatherRecord } from "@/lib/types";

type StoreData = {
  id: string;
  address?: string;
  isActive?: boolean;
  aiEnabled?: boolean;
  forecastConfig?: ForecastConfig;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Each store = one Gemini call. Cap how many run at once so a large store
// count can't burst past the Gemini free-tier rate limit (~10–15 req/min).
const FORECAST_CONCURRENCY = 2;
// Max NEW (not-yet-done) stores forecast per cron fire. Combined with per-store
// done-tracking + the multiple evening fires, this spreads the Gemini calls and
// never re-forecasts a store that already succeeded today.
const FORECAST_BATCH = 4;

/** Map an async fn over items with bounded concurrency, preserving order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Inclusive list of YYYY-MM month ids spanning two dates. */
function monthsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    if (++m > 11) { m = 0; y++; }
  }
  return out;
}

export async function generateForecastForStore(store: StoreData): Promise<{ storeId: string; ok: boolean; error?: string; skipped?: string; forecastsWritten?: number }> {
  const db = getAdminDb();
  // Every date below is a Manila calendar day, matching how analytics docs are
  // keyed. Using server-local dates here is what shifted the whole forecast
  // window back a day — see manila-day.ts.
  const today = manilaDayAnchor();

  // Master AI switch: skip Gemini entirely for stores with AI off (gates the
  // manual refresh route too; cron already filters disabled stores out).
  if (!(await isStoreAiEnabled(db, store.id))) {
    return { storeId: store.id, ok: true, forecastsWritten: 0 };
  }

  try {
    // 2. Fetch 28 days of data
    const historyEndDate = subDays(today, 1);
    const historyStartDate = subDays(historyEndDate, 27);
    const startDayId = anchorDayId(historyStartDate);
    const endDayId = anchorDayId(historyEndDate);
    const todayDayId = anchorDayId(today);

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
        .where("dayId", "<=", anchorDayId(addDays(today, 6)))
        .get(),
    ]);

    const historicalSales = salesSnap.docs.map(d => {
      const data = d.data();
      return {
        date: anchorYmd(manilaDayAnchor(data.meta.dayStartMs!)),
        netSales: data.payments?.totalGross ?? 0,
      };
    });

    if (historicalSales.length < 7) {
      // A brand-new branch genuinely cannot be forecast yet. Reporting that as
      // a FAILURE meant the daily run never reached "success" and burned its
      // whole retry budget on a store that could not possibly succeed — Davao
      // held the cron at pending/attempts=5 every day for a week. It is a skip:
      // marked done for today, retried tomorrow when it may have enough.
      return { storeId: store.id, ok: true, skipped: "Not enough history (need >=7 days)", forecastsWritten: 0 };
    }

    // Weather now lives primarily in monthly weatherForecasts docs (API-logged).
    // Read the months covering the history window + the next 7 days, then build
    // both the historical series and the upcoming forecast from them; fall back
    // to legacy per-day weatherRecords for any day the API hasn't covered.
    const monthIds = monthsBetween(historyStartDate, addDays(today, 7));
    const wfSnaps = await Promise.all(
      monthIds.map((ym) => db.doc(`stores/${store.id}/weatherForecasts/${ym}`).get()),
    );
    const wfDays: Record<string, any> = {};
    for (const s of wfSnaps) {
      if (!s.exists) continue;
      const days = (s.data()?.days ?? {}) as Record<string, any>;
      for (const id of Object.keys(days)) wfDays[id] = days[id];
    }
    const readable = (c: any) => (typeof c === "string" ? c.replace(/_/g, " ") : c);

    const todayDate = anchorYmd(today);
    const histByDate = new Map<string, string>();
    // Legacy weatherRecords (fallback so pre-existing manual history still counts).
    weatherSnap.docs.forEach((d) => {
      const data = d.data() as WeatherRecord;
      const counts = data.entries.reduce((acc, e) => { acc[e.condition] = (acc[e.condition] || 0) + 1; return acc; }, {} as Record<string, number>);
      const summary = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "clear";
      // Pure string reshape of an already-Manila dayId — no Date round-trip,
      // which would reintroduce a machine-timezone dependency here.
      const date = data.dayId.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
      histByDate.set(date, summary.replace("_", " "));
    });
    // API-logged days override for any past day they cover.
    for (const id of Object.keys(wfDays)) {
      if (wfDays[id].date < todayDate) histByDate.set(wfDays[id].date, readable(wfDays[id].condition));
    }
    const historicalWeather = [...histByDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, condition]) => ({ date, condition }));

    // Per-store rain sensitivity: how this branch's sales move on rainy vs clear
    // days (from its own history) — gives the model a store-specific weather weight.
    const salesByDateStr = new Map(historicalSales.map((s) => [s.date, s.netSales]));
    let rainSum = 0, rainN = 0, clearSum = 0, clearN = 0;
    for (const [date, cond] of histByDate) {
      const sales = salesByDateStr.get(date);
      if (sales == null || sales <= 0) continue;
      if (/rain/i.test(cond)) { rainSum += sales; rainN++; } else { clearSum += sales; clearN++; }
    }
    let weatherSensitivity: string | undefined;
    if (rainN >= 2 && clearN >= 2) {
      const rainAvg = rainSum / rainN, clearAvg = clearSum / clearN;
      const pct = Math.round((1 - rainAvg / clearAvg) * 100);
      if (pct > 3) weatherSensitivity = `Rainy days run ~${pct}% below clear days at this branch (₱${Math.round(rainAvg).toLocaleString()} vs ₱${Math.round(clearAvg).toLocaleString()} avg).`;
      else if (pct < -3) weatherSensitivity = `Rainy days run ~${Math.abs(pct)}% ABOVE clear days here — rain doesn't hurt this branch.`;
      else weatherSensitivity = `Rain has little measurable effect on sales at this branch (within a few %).`;
    }

    // Upcoming forecast for the next 7 days (from the API-logged monthly docs),
    // enriched with AM/PM split, avg temp, and rain probability.
    const forecastWeather: { date: string; condition: string; am: string; pm: string; tempC: number | null; popPct: number | null }[] = [];
    for (let i = 0; i < 7; i++) {
      const id = anchorDayId(addDays(today, i));
      const w = wfDays[id];
      if (!w) continue;
      forecastWeather.push({
        date: w.date,
        condition: readable(w.condition),
        am: readable(w.am ?? w.condition),
        pm: readable(w.pm ?? w.condition),
        tempC: typeof w.tempC === "number" ? Math.round(w.tempC) : null,
        popPct: typeof w.pop === "number" ? Math.round(w.pop * 100) : null,
      });
    }

    const dailyContextDocs = dailyContextSnap.docs.map(d => d.data() as DailyContext);
    const todayContext = dailyContextDocs.find(dc => dc.dayId === todayDayId);

    const config = store.forecastConfig;
    const upcomingPayrollDates = getUpcomingPayrollDates(config);

    // Holidays: AI per-store calendar (+ dailyContext overrides), enriched with
    // this branch's learned lift. Falls back to config/default holidays when the
    // calendar hasn't been generated yet.
    const calYears = [...new Set([anchorYear(today), anchorYear(addDays(today, 6))])];
    const calSnaps = await Promise.all(
      calYears.map((y) => db.doc(`stores/${store.id}/holidayCalendar/${y}`).get()),
    );
    const calendarDays: Record<string, HolidayCalendarEntry> = {};
    for (const s of calSnaps) {
      if (s.exists) Object.assign(calendarDays, (s.data()?.days ?? {}) as Record<string, HolidayCalendarEntry>);
    }
    const effectsSnap = await db.doc(`stores/${store.id}/holidayEffects/summary`).get();
    const effects = (effectsSnap.exists ? effectsSnap.data()?.effects : {}) ?? {};

    const windowDayIds = Array.from({ length: 7 }, (_, i) => anchorDayId(addDays(today, i)));
    const overrides: Record<string, string | null> = {};
    for (const dc of dailyContextDocs) {
      if (dc.holiday?.name) overrides[dc.dayId] = dc.holiday.name;
    }
    const upcoming = buildUpcomingHolidays({ calendarDays, overrides, windowDayIds });
    const enriched = enrichUpcomingHolidays(upcoming, effects);
    const upcomingHolidays = enriched.length
      ? enriched
      : getUpcomingHolidays(config).map((h) => `${h.name} on ${h.date}`);
    const dayOfWeekAverages = computeDayOfWeekAverages(historicalSales);
    const { direction: trendDirection, ratio: recentVsHistoricalRatio } = computeTrendDirection(historicalSales);

    const forecastInput: ForecastInput = {
      historicalSales,
      historicalWeather,
      forecastWeather,
      weatherSensitivity,
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
    const todayDayIndex = anchorDayOfWeek(today);
    let writtenCount = 0;

    for (const daily of result.forecast) {
      const forecastDayIndex = DAY_NAMES.indexOf(daily.day);
      if (forecastDayIndex === -1) continue;

      let dayDiff = forecastDayIndex - todayDayIndex;
      if (dayDiff < 0) dayDiff += 7;

      const forecastDate = addDays(today, dayDiff);
      const forecastDateStr = anchorYmd(forecastDate);

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

export async function generateForecastsForAllActiveStores(opts: { doneStoreIds?: Set<string>; batchSize?: number } = {}): Promise<{
  totalStores: number;
  pending: number;
  processed: number;
  remaining: number;
  okStoreIds: string[];
  results: { storeId: string; ok: boolean; error?: string; skipped?: string; forecastsWritten?: number }[];
}> {
  const db = getAdminDb();
  const activeStores = await getActiveStores(db);

  const stores: StoreData[] = activeStores.map((s) => ({
    id: s.id,
    address: s.address ?? undefined,
    isActive: s.isActive ?? undefined,
    aiEnabled: s.aiEnabled ?? undefined,
    forecastConfig: (s.forecastConfig ?? undefined) as ForecastConfig | undefined,
  // Only AI-enabled stores are forecast (no Gemini for disabled stores).
  })).filter((s) => s.aiEnabled === true);

  // Skip stores already forecast today (tracked in the cron log), then cap the
  // batch so each fire stays a small burst.
  const done = opts.doneStoreIds ?? new Set<string>();
  const pending = stores.filter((s) => !done.has(s.id));
  const slice = opts.batchSize ? pending.slice(0, opts.batchSize) : pending;
  const results = await mapWithConcurrency(slice, FORECAST_CONCURRENCY, generateForecastForStore);
  const okStoreIds = results.filter((r) => r.ok).map((r) => r.storeId);
  return {
    totalStores: stores.length,
    pending: pending.length,
    processed: slice.length,
    remaining: pending.length - slice.length,
    okStoreIds,
    results,
  };
}

/* ------------------------------------------------------------------ */
/*  Standalone accuracy update (decoupled from forecast generation)   */
/* ------------------------------------------------------------------ */

export async function updateAccuracyForAllActiveStores(): Promise<{
  totalStores: number;
  results: { storeId: string; ok: boolean; error?: string; learnedDays?: number; bootstrapped?: boolean; reasoned?: boolean }[];
}> {
  const db = getAdminDb();
  const activeStores = await getActiveStores(db);

  const results = await Promise.all(
    activeStores.map(async (s) => {
      try {
        const r = await learnForecastModel(s.id, (s.forecastConfig ?? undefined) as ForecastConfig | undefined, {
          aiEnabled: s.aiEnabled === true,
        });
        return { storeId: s.id, ok: true, ...r };
      } catch (err: any) {
        console.error(`[updateAccuracy] store=${s.id} failed:`, err);
        return { storeId: s.id, ok: false, error: err.message || String(err) };
      }
    }),
  );

  return { totalStores: activeStores.length, results };
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
  status: "success" | "failed" | "pending";
  attempts: number;
  lastAttemptAt: Timestamp;
  successAt: Timestamp | null;
  /** Store ids already forecast successfully today — skipped on later fires. */
  doneStoreIds?: string[];
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
  const done = new Set<string>(currentLog?.doneStoreIds ?? []);

  try {
    const result = await generateForecastsForAllActiveStores({ doneStoreIds: done, batchSize: FORECAST_BATCH });
    for (const id of result.okStoreIds) done.add(id);
    const batchOk = result.results.every((r) => r.ok);
    // "success" only when no stores remain AND this batch had no failures;
    // otherwise "pending" so a later fire forecasts the rest / retries failures.
    const allDone = result.remaining === 0 && batchOk;

    await writeDayRunLog(dateStr, {
      status: allDone ? "success" : "pending",
      attempts,
      lastAttemptAt: Timestamp.now(),
      successAt: allDone ? Timestamp.now() : null,
      doneStoreIds: [...done],
    });

    return {
      skipped: false,
      reason: allDone ? "Forecast succeeded." : `Processed ${result.processed}; ${result.remaining} store(s) remaining.`,
      result,
    };
  } catch (err) {
    await writeDayRunLog(dateStr, {
      status: "pending",
      attempts,
      lastAttemptAt: Timestamp.now(),
      successAt: null,
      doneStoreIds: [...done],
    });
    throw err;
  }
}
