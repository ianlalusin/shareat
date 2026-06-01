import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { fetchOwmForecast, summarizeDays, type DaySummary } from "@/lib/weather/owm";
import type { DailyWeatherForecast } from "@/lib/types";

export type StoreLogResult = {
  storeId: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  daysWritten?: number;
  error?: string;
};

/**
 * Fetch this store's weather forecast from OpenWeatherMap and upsert each day's
 * summary into the monthly doc `stores/{storeId}/weatherForecasts/{YYYY-MM}`.
 * One API call per store. Stores without a geotag are skipped (reported).
 */
export async function logWeatherForStore(store: { id: string; geo?: { lat?: number; lng?: number } | null }): Promise<StoreLogResult> {
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

    return { storeId: store.id, ok: true, daysWritten };
  } catch (err: any) {
    console.error(`[weather-logger] store=${store.id} failed:`, err?.message || err);
    return { storeId: store.id, ok: false, error: err?.message || String(err) };
  }
}

export async function logWeatherForAllActiveStores(): Promise<{ totalStores: number; results: StoreLogResult[] }> {
  const db = getAdminDb();
  const snap = await db.collection("stores").where("isActive", "==", true).get();
  const stores = snap.docs.map((d) => ({ id: d.id, geo: (d.data() as any).geo ?? null }));
  const results = await Promise.all(stores.map(logWeatherForStore));
  return { totalStores: stores.length, results };
}
