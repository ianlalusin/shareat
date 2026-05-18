import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Rebuilds the per-store customer catalog cache from the global catalogItems
 * collection and the per-store POS inventory. Mirrors the CUSTOMER backend's
 * /api/admin/rebuild-store-catalog-cache logic so POS can be self-contained.
 *
 * - Items not yet in the cache are imported.
 * - Existing cache items keep their per-store overrides (price tweaks, hidden flags)
 *   but link metadata is always refreshed from the global doc.
 * - When an item is linked to a POS product AND the active inventory record for
 *   this store has a positive sellingPrice, the POS sellingPrice replaces the
 *   cache `price`. Otherwise the customer-set price stays.
 */
export async function rebuildStoreCatalogCache(
  db: Firestore,
  storeId: string
): Promise<{ itemCount: number; importedCount: number; updatedAtMs: number }> {
  if (!storeId) throw new Error("storeId required.");

  const qSnap = await db.collection("catalogItems").orderBy("name", "asc").get();

  const storeRef = db.doc(`stores/${storeId}/catalogCache/main`);
  const storeSnap = await storeRef.get();
  const prev = storeSnap.exists ? (storeSnap.data() as any) : null;
  const prevItems: any[] = Array.isArray(prev?.items) ? prev.items : [];

  const prevById = new Map<string, any>();
  for (const it of prevItems) {
    const id = String(it?.id || "");
    if (id) prevById.set(id, it);
  }

  const globalById = new Map<string, any>();
  for (const d of qSnap.docs) globalById.set(d.id, d.data() as any);

  // Per-store POS inventory keyed by productId. Used to overlay sellingPrice
  // onto any linked customer item. POS price wins when present.
  const invSnap = await db.collection(`stores/${storeId}/inventory`).get();
  const invByProductId = new Map<string, any>();
  for (const d of invSnap.docs) {
    const x = d.data() as any;
    if (x?.isActive === false) continue;
    if (x?.isArchived === true) continue;
    const pid = String(x?.productId || "");
    if (pid) invByProductId.set(pid, x);
  }

  function resolvePrice(linkedPosProductId: any, fallback: number): number {
    if (!linkedPosProductId) return fallback;
    const inv = invByProductId.get(String(linkedPosProductId));
    if (!inv) return fallback;
    const sp = Number(inv.sellingPrice ?? 0);
    if (!Number.isFinite(sp) || sp <= 0) return fallback;
    return sp;
  }

  const refreshedPrevItems = prevItems.map((it: any) => {
    const g = globalById.get(String(it?.id || ""));
    if (!g) return it;
    const linkedId = g.linkedPosProductId ?? null;
    const fallbackPrice = Number(it?.price ?? g.price ?? 0);
    return {
      ...it,
      linkedPosProductId: linkedId,
      linkedPosProductName: g.linkedPosProductName ?? null,
      price: resolvePrice(linkedId, fallbackPrice),
    };
  });

  const missingItems = qSnap.docs
    .map((d) => {
      const x = d.data() as any;
      if (x.isArchived === true) return null;
      if (prevById.has(d.id)) return null;

      const globalDisabled = (x.isAvailable === false);
      const globalAvailable = !globalDisabled;
      const linkedId = x.linkedPosProductId ?? null;
      const fallbackPrice = Number(x.price ?? 0);

      return {
        id: d.id,
        name: String(x.name ?? ""),
        category: String(x.category ?? ""),
        imageUrl: x.imageUrl ?? null,
        price: resolvePrice(linkedId, fallbackPrice),
        isAvailable: globalAvailable,
        globalIsAvailable: globalAvailable,
        globalUpdatedAtMs: x.updatedAt?.toMillis ? Number(x.updatedAt.toMillis()) : null,
        storeUpdatedAtMs: null,
        linkedPosProductId: linkedId,
        linkedPosProductName: x.linkedPosProductName ?? null,
      };
    })
    .filter(Boolean) as any[];

  const items = [...refreshedPrevItems, ...missingItems].sort((a: any, b: any) =>
    String(a?.name || "").localeCompare(String(b?.name || ""))
  );

  const nowMs = Date.now();
  await storeRef.set(
    {
      updatedAtMs: nowMs,
      itemCount: items.filter((x: any) => x.isAvailable === true).length,
      items,
    },
    { merge: true }
  );

  return {
    itemCount: items.filter((x: any) => x.isAvailable === true).length,
    importedCount: missingItems.length,
    updatedAtMs: nowMs,
  };
}
