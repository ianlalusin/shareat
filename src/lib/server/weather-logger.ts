import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { fetchOwmForecast, mapOwmIdToCondition, summarizeDays, type DaySummary } from "@/lib/weather/owm";
import type { DailyWeatherForecast } from "@/lib/types";

export type StoreLogResult = {
  storeId: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  daysWritten?: number;
  error?: string;
};

/** True if the current Manila time is within the store's opening–closing window.
 *  No hours configured ⇒ treated as always open (don't drop data). */
function isWithinStoreHours(openingTime?: string | null, closingTime?: string | null): boolean {
  if (!openingTime || !closingTime) return true;
  const manila = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const cur = manila.getHours() * 60 + manila.getMinutes();
  const [oh, om] = openingTime.split(":").map(Number);
  const [ch, cm] = closingTime.split(":").map(Number);
  if ([oh, om, ch, cm].some((n) => Number.isNaN(n))) return true;
  const start = oh * 60 + om;
  const end = ch * 60 + cm;
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end; // overnight-aware
}

/**
 * Fetch this store's weather forecast from OpenWeatherMap and upsert each day's
 * summary into the monthly doc `stores/{storeId}/weatherForecasts/{YYYY-MM}`.
 * One API call per store. Stores without a geotag are skipped (reported).
 */
export async function logWeatherForStore(store: {
  id: string;
  geo?: { lat?: number; lng?: number } | null;
  openingTime?: string | null;
  closingTime?: string | null;
}): Promise<StoreLogResult> {
  const lat = store.geo?.lat;
  const lng = store.geo?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { storeId: store.id, ok: true, skipped: true, reason: "No geotag set" };
  }

  const db = getAdminDb();
  const now = Date.now();

  try {
    const slots = await fetchOwmForecast(lat, lng);
    const summaries = summarizeDays(slots);
    if (summaries.length === 0) return { storeId: store.id, ok: true, daysWritten: 0 };

    // Group days by month so we touch each monthly doc once.
    const byMonth = new Map<string, DaySummary[]>();
    for (const s of summaries) {
      const ym = s.date.slice(0, 7); // YYYY-MM
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym)!.push(s);
    }

    const batch = db.batch();
    let daysWritten = 0;
    for (const [ym, days] of byMonth) {
      const ref = db.doc(`stores/${store.id}/weatherForecasts/${ym}`);
      const daysMap: Record<string, DailyWeatherForecast> = {};
      for (const s of days) {
        daysMap[s.dayId] = {
          date: s.date,
          condition: s.condition,
          am: s.am,
          pm: s.pm,
          tempC: s.tempC,
          pop: s.pop,
          owmMain: s.owmMain,
          source: "owm",
          fetchedAtMs: now,
        };
        daysWritten++;
      }
      batch.set(ref, { ym, storeId: store.id, updatedAtMs: now, days: daysMap }, { merge: true });
    }
    await batch.commit();

    // Also append a live "System" entry to today's observation log
    // (weatherRecords) so the "Today's Weather Log" reflects the API hourly —
    // the API is the primary logger now; the manual modal is only a fallback.
    // Only during store hours (skip overnight when the store is closed).
    // Condition = the forecast slot nearest to now (the current conditions),
    // not the whole-day summary.
    if (isWithinStoreHours(store.openingTime, store.closingTime)) try {
      const nowS = Date.now() / 1000;
      const nearest = slots.reduce((b, s) => (Math.abs((s.dt || 0) - nowS) < Math.abs((b.dt || 0) - nowS) ? s : b), slots[0]);
      const currentCond = mapOwmIdToCondition(nearest?.weather?.[0]?.id);
      const currentTemp = typeof nearest?.main?.temp === "number" ? Math.round(nearest.main.temp) : null;
      const manila = new Date(Date.now() + 8 * 3600 * 1000); // shift to Manila, read UTC getters
      const todayDayId = `${manila.getUTCFullYear()}${String(manila.getUTCMonth() + 1).padStart(2, "0")}${String(manila.getUTCDate()).padStart(2, "0")}`;
      await db.doc(`stores/${store.id}/weatherRecords/${todayDayId}`).set({
        dayId: todayDayId,
        entries: FieldValue.arrayUnion({
          timestamp: Timestamp.now(),
          condition: currentCond,
          tempC: currentTemp,
          activeSessionCount: 0,
          activeGuestCount: 0,
          loggedByUid: "system",
          loggedByProfileId: null,
          loggedByProfileName: "System",
        }),
      }, { merge: true });
    } catch (e) {
      console.warn(`[weather-logger] observation-log append failed for ${store.id}:`, (e as any)?.message || e);
    }

    return { storeId: store.id, ok: true, daysWritten };
  } catch (err: any) {
    console.error(`[weather-logger] store=${store.id} failed:`, err?.message || err);
    return { storeId: store.id, ok: false, error: err?.message || String(err) };
  }
}

export async function logWeatherForAllActiveStores(): Promise<{ totalStores: number; results: StoreLogResult[] }> {
  const db = getAdminDb();
  const snap = await db.collection("stores").where("isActive", "==", true).get();
  const stores = snap.docs.map((d) => {
    const data = d.data() as any;
    return { id: d.id, geo: data.geo ?? null, openingTime: data.openingTime ?? null, closingTime: data.closingTime ?? null };
  });
  const results = await Promise.all(stores.map(logWeatherForStore));
  return { totalStores: stores.length, results };
}
