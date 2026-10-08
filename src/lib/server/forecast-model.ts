// src/lib/server/forecast-model.ts
import "server-only";

import { FieldPath } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { anchorYmd, manilaDayAnchor } from "@/lib/analytics/manila-day";
import { dayIdToDate } from "@/lib/holidays/holiday-calendar";
import { explainForecastModel } from "@/ai/flows/explain-forecast-model";
import {
  emptyModel, foldAccuracy, forecastDay, learnDay, shouldRefreshReasoning, symmetricAccuracy, MODEL_VERSION,
  type ForecastModel, type ModelDayForecast,
} from "@/lib/forecast/model";
import { buildDayContext, daysToLearn, toDayId, type ContextSources } from "@/lib/forecast/context";
import { addDaysYmd, effectivePaydays, paydayDaysOfMonth } from "@/lib/forecast/payday";
import type { ForecastConfig, SalesForecast } from "@/lib/types";

const BOOTSTRAP_DAYS = 90;

const modelDoc = (storeId: string) => getAdminDb().doc(`stores/${storeId}/forecastModel/current`);

export async function loadForecastModel(storeId: string): Promise<ForecastModel | null> {
  const snap = await modelDoc(storeId).get();
  const m = snap.exists ? (snap.data() as ForecastModel) : null;
  return m && m.version === MODEL_VERSION ? m : null;
}

function monthIds(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  for (let d = `${fromYmd.slice(0, 7)}-01`; d.slice(0, 7) <= toYmd.slice(0, 7); d = addDaysYmd(d, 32).slice(0, 8) + "01") {
    out.push(d.slice(0, 7));
  }
  return out;
}

export async function loadContextSources(
  storeId: string, config: ForecastConfig | undefined, fromYmd: string, toYmd: string,
): Promise<ContextSources> {
  const db = getAdminDb();
  const years = [...new Set(monthIds(fromYmd, toYmd).map((m) => m.slice(0, 4)))];
  const [calSnaps, wfSnaps, dcSnap, effSnap] = await Promise.all([
    Promise.all(years.map((y) => db.doc(`stores/${storeId}/holidayCalendar/${y}`).get())),
    Promise.all(monthIds(fromYmd, toYmd).map((ym) => db.doc(`stores/${storeId}/weatherForecasts/${ym}`).get())),
    db.collection(`stores/${storeId}/dailyContext`)
      .where(FieldPath.documentId(), ">=", toDayId(fromYmd))
      .where(FieldPath.documentId(), "<=", toDayId(toYmd))
      .get(),
    db.doc(`stores/${storeId}/holidayEffects/summary`).get(),
  ]);
  const src: ContextSources = {
    calendarNames: {}, holidayOverrides: {}, staffPaydays: new Set(),
    effects: (effSnap.data()?.effects ?? {}) as ContextSources["effects"],
    paydays: [], weather: {},
  };
  for (const s of calSnaps) {
    for (const [id, e] of Object.entries((s.data()?.days ?? {}) as Record<string, { name: string }>)) src.calendarNames[id] = e.name;
  }
  for (const s of wfSnaps) Object.assign(src.weather, s.data()?.days ?? {});
  for (const d of dcSnap.docs) {
    const x = d.data();
    if (typeof x.holiday?.name === "string") src.holidayOverrides[d.id] = x.holiday.name;
    if (x.isPayday?.value === true) src.staffPaydays.add(d.id);
  }
  const dom = paydayDaysOfMonth(config);
  src.paydays = dom ? effectivePaydays(dom, fromYmd, toYmd) : [];
  return src;
}

/**
 * Nightly: learn every unprocessed day up to yesterday (bootstrap 90 days on
 * first run), write accuracy onto those days' forecast docs, and on Sundays
 * refresh the AI reasoning. Idempotent; a missed night is caught up next run.
 */
export async function learnForecastModel(
  storeId: string, config: ForecastConfig | undefined, opts: { aiEnabled: boolean; nowMs?: number },
): Promise<{ learnedDays: number; bootstrapped: boolean; reasoned: boolean }> {
  const db = getAdminDb();
  const nowMs = opts.nowMs ?? Date.now();
  const today = anchorYmd(manilaDayAnchor(nowMs));
  const yesterday = addDaysYmd(today, -1);
  const existing = await loadForecastModel(storeId);
  let model = existing ?? emptyModel(storeId);
  const start = model.processedThrough ? addDaysYmd(model.processedThrough, 1) : addDaysYmd(today, -BOOTSTRAP_DAYS);
  let learnedDays = 0;

  if (start <= yesterday) {
    const [anSnap, src] = await Promise.all([
      db.collection(`stores/${storeId}/analytics`)
        .where(FieldPath.documentId(), ">=", toDayId(start))
        .where(FieldPath.documentId(), "<=", toDayId(yesterday))
        .get(),
      loadContextSources(storeId, config, start, yesterday),
    ]);
    const sales = new Map<string, number>();
    for (const d of anSnap.docs) sales.set(dayIdToDate(d.id), d.data()?.payments?.totalGross ?? 0);

    const dates = daysToLearn(model.processedThrough || null, today, (d) => sales.has(d), BOOTSTRAP_DAYS);
    if (dates.length) {
      const fcSnaps = await db.getAll(...dates.map((d) => db.doc(`stores/${storeId}/salesForecasts/${d}`)));
      const batch = db.batch();
      let writes = 0;
      dates.forEach((date, i) => {
        const actual = sales.get(date) ?? 0;
        const snap = fcSnaps[i];
        if (snap.exists && actual > 0) {
          const fc = snap.data() as SalesForecast;
          const upd: Record<string, number> = {};
          if (fc.actualSales == null) upd.actualSales = actual;
          if (fc.accuracy == null && typeof fc.projectedSales === "number") upd.accuracy = symmetricAccuracy(fc.projectedSales, actual);
          if (fc.modelAccuracy == null && typeof fc.modelSales === "number") upd.modelAccuracy = symmetricAccuracy(fc.modelSales, actual);
          if (Object.keys(upd).length) { batch.update(snap.ref, upd); writes++; }
          // Like-for-like: fold only days where both engines projected.
          if (typeof fc.modelSales === "number" && typeof fc.llmSales === "number") {
            model = {
              ...model,
              accuracy: {
                model: foldAccuracy(model.accuracy.model, fc.modelSales, actual),
                llm: foldAccuracy(model.accuracy.llm, fc.llmSales, actual),
              },
            };
          }
        }
        model = learnDay(model, buildDayContext(date, src, "learn"), actual);
        learnedDays++;
      });
      if (writes) await batch.commit();
    }
  }

  // Persist the learned model first: the AI call below is slow and the cron has
  // a hard time limit, so a reasoning timeout must never lose the night's learning.
  if (learnedDays > 0 || !existing) {
    await modelDoc(storeId).set({ ...model, updatedAtMs: nowMs });
  }

  let reasoned = false;
  if (shouldRefreshReasoning(model, today, nowMs, opts.aiEnabled)) {
    try {
      const r = await explainForecastModel(model);
      const reasoning = { summary: r.summary, flags: r.flags, provider: r.provider, generatedAt: nowMs };
      await modelDoc(storeId).set({ reasoning, updatedAtMs: nowMs }, { merge: true });
      reasoned = true;
    } catch (e) {
      console.warn(`[learnForecastModel] store=${storeId} reasoning failed:`, e);
    }
  }
  return { learnedDays, bootstrapped: !existing, reasoned };
}

/** The model's next-7-day projection from today. Days whose weekday has no baseline yet are omitted. */
export async function forecastNext7(
  storeId: string, config: ForecastConfig | undefined, todayYmd: string, model: ForecastModel,
): Promise<({ date: string } & ModelDayForecast)[]> {
  const src = await loadContextSources(storeId, config, todayYmd, addDaysYmd(todayYmd, 6));
  const out: ({ date: string } & ModelDayForecast)[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysYmd(todayYmd, i);
    const f = forecastDay(model, buildDayContext(date, src, "forecast"));
    if (f) out.push({ date, ...f });
  }
  return out;
}
