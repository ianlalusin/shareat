import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

export type StoreInventoryRow = { id: string; data: Record<string, any> };

/**
 * Short — this only needs to survive the gap between two auto-publish calls
 * triggered by the same edit (see below), not to serve as a long-lived cache.
 * A manual "Rebuild" click a few seconds after an edit still gets fresh data.
 */
const CACHE_TTL_MS = 20_000;

function cacheDocPath(storeId: string): string {
  return `stores/${storeId}/inventoryCache/main`;
}

/**
 * Shared read path for "every inventory row of this store," raw and
 * unfiltered — replaces what used to be two independent
 * `stores/{id}/inventory` full-collection scans, one each in
 * `rebuildCustomerCatalog` (customer-catalog.ts) and `rebuildStorefrontCatalog`
 * (storefront-catalog.ts). Both rebuilds fire together on the same inventory
 * edit — `src/lib/customer-catalog/auto-publish.ts` and
 * `src/lib/storefront/auto-publish.ts`, each independently debounced ~1.5s —
 * so a single price/availability edit paid for the same collection scan
 * twice.
 *
 * Each caller keeps its own filtering (customerEnabled vs onlineEnabled,
 * sellingPrice vs onlinePrice, etc.) — this only shares the RAW fetch, not a
 * shaped result, since the two consumers' eligibility rules differ.
 *
 * Firestore-doc-backed rather than an in-memory cache: the two rebuild calls
 * are separate HTTP requests to separate API routes with no guarantee they
 * land on the same serverless instance, so an in-process cache would miss
 * most of the time. Self-healing: a missing/expired cache doc just triggers
 * a fresh scan.
 *
 * `stores/{id}/inventoryCache` is server-write-only — see firestore.rules,
 * excluded from the store-scoped catch-all's client write grant, same as
 * analytics/dashPresets/storefrontCatalog, so a client can never poison it.
 */
export async function getStoreInventoryRows(
  db: Firestore,
  storeId: string,
  opts: { ttlMs?: number } = {},
): Promise<StoreInventoryRow[]> {
  const ttlMs = opts.ttlMs ?? CACHE_TTL_MS;
  const cacheRef = db.doc(cacheDocPath(storeId));
  const cached = await cacheRef.get();
  const updatedAt = cached.get("updatedAt");
  const rows = cached.get("rows") as StoreInventoryRow[] | undefined;
  const updatedAtMs = typeof updatedAt?.toMillis === "function" ? updatedAt.toMillis() : null;

  if (updatedAtMs !== null && Array.isArray(rows) && Date.now() - updatedAtMs < ttlMs) {
    return rows;
  }

  const snap = await db.collection(`stores/${storeId}/inventory`).get();
  // `d.data()` never contains a JS `undefined` value (Firestore has no such
  // type — an absent field is simply absent), so writing it back verbatim is
  // safe without the per-field `?? null` normalization active-stores-cache.ts
  // needs for hand-built objects.
  const fresh: StoreInventoryRow[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));

  try {
    await cacheRef.set({ rows: fresh, updatedAt: FieldValue.serverTimestamp() });
  } catch (err) {
    console.error("[getStoreInventoryRows] cache write failed, serving fresh scan uncached:", err);
  }
  return fresh;
}
