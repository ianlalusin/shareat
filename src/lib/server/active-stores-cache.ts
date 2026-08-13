import "server-only";

import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Every field any current consumer (cron jobs + the external stores API)
 * reads off an active store doc. Adding a new consumer that needs another
 * field means adding it here, not re-introducing a live collection query.
 *
 * Every field is nullable on purpose, even ones a store doc "always" has —
 * the Admin SDK rejects `undefined` in a write, so the scan below normalizes
 * every optional field to `null` before it ever reaches `cacheRef.set()`.
 */
export type ActiveStoreRecord = {
  id: string;
  name?: string | null;
  address?: string | null;
  isActive?: boolean | null;
  aiEnabled?: boolean | null;
  forecastConfig?: unknown | null;
  geo?: { lat: number; lng: number } | null;
  openingTime?: string | null;
  closingTime?: string | null;
};

const CACHE_DOC_PATH = "system/activeStoresCache";

/**
 * How stale the list is allowed to be before a consumer forces a re-scan.
 *
 * Deliberately ABOVE the tightest existing cron cadence (reconcile-analytics
 * and holiday-calendar both fire every 15 min, `docs/CRON.md`) rather than
 * equal to it: `updatedAt` is stamped after a scan completes, so a TTL of
 * exactly 15 min would put every refresh right at the edge of the next fire
 * and make the hit/miss outcome depend on scan duration and Cloud Scheduler
 * jitter — sometimes caching nothing at all. At 20 min, a fire that misses
 * and repopulates is guaranteed to be hit by the next same-cadence fire 15
 * min later, regardless of jitter.
 *
 * This does NOT dedupe two jobs scheduled at the exact same instant (reconcile
 * -analytics and holiday-calendar both run on the same every-15-minutes cron
 * expression, i.e. the same minute) — both can still miss and scan concurrently
 * on a refresh tick, since
 * there's no lock, just a cache. That's an accepted gap: a harmless duplicate
 * scan+write once every couple of cycles, not worth a distributed lock for a
 * background read-cost optimization. Every OTHER consumer (log-weather,
 * generate-forecast, update-accuracy, rebuild-presets, generate-daily-insight,
 * the external stores API) is not aligned to that same instant and gets a
 * real cache hit most of the time.
 */
const DEFAULT_TTL_MS = 20 * 60 * 1000;

/**
 * Shared read path for "every active store", replacing what used to be a
 * separate `stores` WHERE isActive == true collection scan in every cron job
 * (reconcile-analytics, holiday-calendar, log-weather, generate-forecast,
 * update-accuracy, rebuild-presets, generate-daily-insight) plus the external
 * stores API — several of those on a 15-minute or hourly schedule. That query
 * was the top hit in Firestore's index usage panel purely from fan-out, not
 * from any single caller being expensive.
 *
 * Caches the full active-store list in `system/activeStoresCache`. Self-
 * healing: a missing or corrupt cache doc just looks like an expired one and
 * triggers a fresh scan. If the scan itself fails, the error propagates (same
 * as before this cache existed — a caller that couldn't read the stores
 * collection couldn't do its job either way). If only the cache WRITE fails
 * (permissions blip, transient error), that's swallowed — the freshly-scanned
 * result is still correct and still returned; the next caller just scans
 * again instead of losing this call's result.
 *
 * `system/*` is server (Admin SDK) only — see firestore.rules, the generic
 * staff catch-all explicitly excludes the `system` collection so this cache
 * is never client-readable.
 */
export async function getActiveStores(
  db: Firestore,
  opts: { ttlMs?: number } = {},
): Promise<ActiveStoreRecord[]> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const cacheRef = db.doc(CACHE_DOC_PATH);
  const cached = await cacheRef.get();
  const updatedAt = cached.get("updatedAt") as Timestamp | undefined;
  const stores = cached.get("stores") as ActiveStoreRecord[] | undefined;
  const updatedAtMs = typeof updatedAt?.toMillis === "function" ? updatedAt.toMillis() : null;

  if (updatedAtMs !== null && Array.isArray(stores) && Date.now() - updatedAtMs < ttlMs) {
    return stores;
  }

  const snap = await db.collection("stores").where("isActive", "==", true).get();
  const fresh: ActiveStoreRecord[] = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name ?? null,
      address: data.address ?? null,
      isActive: data.isActive ?? null,
      aiEnabled: data.aiEnabled ?? null,
      forecastConfig: data.forecastConfig ?? null,
      geo: data.geo ?? null,
      openingTime: data.openingTime ?? null,
      closingTime: data.closingTime ?? null,
    };
  });

  try {
    await cacheRef.set({ stores: fresh, updatedAt: FieldValue.serverTimestamp() });
  } catch (err) {
    console.error("[getActiveStores] cache write failed, serving fresh scan uncached:", err);
  }
  return fresh;
}
