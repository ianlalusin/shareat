import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Every field any current consumer (cron jobs + the external stores API)
 * reads off an active store doc. Adding a new consumer that needs another
 * field means adding it here, not re-introducing a live collection query.
 */
export type ActiveStoreRecord = {
  id: string;
  name?: string;
  address?: string;
  isActive?: boolean;
  aiEnabled?: boolean;
  forecastConfig?: unknown;
  geo?: { lat: number; lng: number } | null;
  openingTime?: string | null;
  closingTime?: string | null;
};

const CACHE_DOC_PATH = "system/activeStoresCache";

/**
 * How stale the list is allowed to be before a consumer forces a re-scan.
 * Chosen to match the tightest existing cron cadence (reconcile-analytics /
 * holiday-calendar both run every 15 min) — no consumer waits longer for a
 * store activation/deactivation to take effect than it already implicitly
 * tolerated before this cache existed.
 */
const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * Shared read path for "every active store", replacing what used to be a
 * separate `stores` WHERE isActive == true collection scan in every cron job
 * (reconcile-analytics, holiday-calendar, log-weather, generate-forecast,
 * update-accuracy, rebuild-presets, generate-daily-insight) plus the external
 * stores API — several of those on a 15-minute or hourly schedule. That query
 * was the top hit in Firestore's index usage panel purely from fan-out, not
 * from any single caller being expensive.
 *
 * Caches the full active-store list in `system/activeStoresCache`, refreshed
 * at most once per `ttlMs`. Whichever cron fires first after expiry pays for
 * the real query and repopulates the cache; every other caller within the
 * window reads one cheap doc instead. Self-healing: a missing/corrupt cache
 * doc just looks like an expired one and triggers a fresh scan.
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

  if (updatedAt && Array.isArray(stores) && Date.now() - updatedAt.toMillis() < ttlMs) {
    return stores;
  }

  const snap = await db.collection("stores").where("isActive", "==", true).get();
  const fresh: ActiveStoreRecord[] = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name,
      address: data.address,
      isActive: data.isActive,
      aiEnabled: data.aiEnabled,
      forecastConfig: data.forecastConfig,
      geo: data.geo ?? null,
      openingTime: data.openingTime ?? null,
      closingTime: data.closingTime ?? null,
    };
  });

  await cacheRef.set({ stores: fresh, updatedAt: FieldValue.serverTimestamp() });
  return fresh;
}
