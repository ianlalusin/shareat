import type { Firestore } from "firebase-admin/firestore";
import { buildCustomerCatalogSnapshot } from "./customer-catalog";
import { getActiveStores } from "./active-stores-cache";

/**
 * Nightly backstop for the customer catalog.
 *
 * `stores/{id}/catalogCache/main` has one writer, and it is only ever reached
 * through `scheduleCustomerCatalogAutoPublish` — a debounced, client-side,
 * best-effort call from three manager screens. Edit the menu anywhere else,
 * or close the tab before the debounce fires, and the rebuild is simply lost.
 * On 2026-08-23 that had left four of seven stores serving a catalog last
 * built on 2026-08-08 by a one-off backfill; diners at those branches saw a
 * two-week-old menu with no error anywhere.
 *
 * This sweep makes that self-healing within a day, the same way
 * `reconcile-analytics` backstops the per-receipt analytics deltas.
 */

export type CatalogSweepDecision = { action: "write" | "skip"; reason: string };

/**
 * Whether a freshly built snapshot is safe to publish over the current one.
 *
 * The one thing an unattended nightly job must never do is empty a live menu
 * across the estate because a source read went wrong. A shrink is allowed —
 * stores legitimately shrink when they catch up to a newer builder — but going
 * from "has a menu" to "has nothing" is always treated as a fault and skipped
 * for a human to look at.
 */
export function decideCatalogWrite(
  currentItemCount: number | undefined,
  nextItemCount: number,
): CatalogSweepDecision {
  const current = Number(currentItemCount) || 0;
  if (nextItemCount > 0) return { action: "write", reason: `${current} -> ${nextItemCount}` };
  if (current === 0) return { action: "write", reason: "empty before and after" };
  return {
    action: "skip",
    reason: `rebuild produced 0 items but the store currently publishes ${current} — refusing to blank a live menu`,
  };
}

export type CatalogSweepResult = {
  totalStores: number;
  written: number;
  skipped: number;
  failed: number;
  results: Array<{
    storeId: string;
    action: "write" | "skip" | "failed";
    reason: string;
    before?: number;
    after?: number;
  }>;
};

export async function sweepCustomerCatalogs(
  db: Firestore,
  opts: { write: boolean },
): Promise<CatalogSweepResult> {
  const activeStores = await getActiveStores(db);
  const results: CatalogSweepResult["results"] = [];

  for (const store of activeStores) {
    const storeId = store.id;
    try {
      const ref = db.doc(`stores/${storeId}/catalogCache/main`);
      const before = Number((await ref.get()).data()?.itemCount) || 0;

      // Built once, inspected, then published — never built twice, since each
      // build reads the whole `products` collection.
      const snapshot = await buildCustomerCatalogSnapshot(db, storeId);
      const decision = decideCatalogWrite(before, snapshot.itemCount);

      if (decision.action === "skip") {
        console.warn(`[catalog-sweep] ${storeId}: ${decision.reason}`);
        results.push({ storeId, action: "skip", reason: decision.reason, before, after: snapshot.itemCount });
        continue;
      }

      if (opts.write) await ref.set(snapshot);
      results.push({
        storeId,
        action: "write",
        reason: opts.write ? decision.reason : `would write (${decision.reason})`,
        before,
        after: snapshot.itemCount,
      });
    } catch (err: any) {
      // One bad store must not stop the rest of the estate refreshing.
      console.error(`[catalog-sweep] ${storeId} failed:`, err);
      results.push({ storeId, action: "failed", reason: err?.message ?? "unknown error" });
    }
  }

  return {
    totalStores: activeStores.length,
    written: results.filter((r) => r.action === "write").length,
    skipped: results.filter((r) => r.action === "skip").length,
    failed: results.filter((r) => r.action === "failed").length,
    results,
  };
}
