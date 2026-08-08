import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

export type CustomerCatalogItem = {
  id: string; // POS productId — the CUSTOMER app only uses this as a display key.
  name: string;
  category: string;
  imageUrl: string | null;
  price: number;
  isAvailable: true; // withheld items are simply absent from the array.
};

/**
 * Rebuilds the per-store CUSTOMER app catalog cache directly from the global
 * `products` collection and this store's `inventory` — the same two
 * collections `rebuildStorefrontCatalog` (storefront-catalog.ts) reads.
 *
 * Availability is store-scoped and opt-in, mirroring the online-storefront
 * gate exactly: `inventory.customerEnabled === true` is the ONLY gate. A
 * missing value means NOT offered.
 *
 * Pricing is `customerPrice ?? sellingPrice`, with the same withholding rule
 * as `onlinePrice`: a `customerPrice` that is set but not positive (0 or
 * negative) withholds the item rather than falling back — an item switched
 * on for the customer app but not yet priced there should not appear at the
 * table price by accident.
 *
 * Unlike the old `catalogItems`-based cache, this is a pure projection with
 * no state of its own: every rebuild fully replaces `items`. There is no more
 * per-store "override" living inside the cache document — all editing now
 * happens on the inventory record itself, via the manager inventory page.
 *
 * The CUSTOMER app has no concept of product families/variants, so every
 * sellable inventory row (a single product or one variant) becomes its own
 * flat item, matching what it already reads
 * (`{ id, name, category, imageUrl, price, isAvailable }`).
 */
export async function rebuildCustomerCatalog(
  db: Firestore,
  storeId: string
): Promise<{ itemCount: number; updatedAtMs: number }> {
  if (!storeId) throw new Error("storeId required.");

  const productsSnap = await db.collection("products").get();
  const productById = new Map(productsSnap.docs.map((d) => [d.id, d.data() as any]));

  const invSnap = await db.collection(`stores/${storeId}/inventory`).get();

  /**
   * The price the customer app charges, or null when the item is not
   * sellable there and must be omitted. Same two distinct states as
   * `resolvePrice` in storefront-catalog.ts:
   *   customerPrice UNSET (missing/null) → charge the dine-in `sellingPrice`.
   *   customerPrice SET but not positive (0, negative) → WITHHELD.
   */
  function resolvePrice(inv: any): number | null {
    const raw = inv.customerPrice;
    if (raw !== null && raw !== undefined && raw !== "") {
      const cp = Number(raw);
      return Number.isFinite(cp) && cp > 0 ? cp : null;
    }
    const sp = Number(inv.sellingPrice ?? 0);
    if (!Number.isFinite(sp) || sp <= 0) return null;
    return sp;
  }

  const items: CustomerCatalogItem[] = [];
  for (const d of invSnap.docs) {
    const inv = d.data() as any;
    if (inv?.isActive === false) continue;
    if (inv?.isArchived === true) continue;
    if (inv?.customerEnabled !== true) continue;

    const price = resolvePrice(inv);
    if (price == null) continue;

    const productId = String(inv.productId || "");
    const product = productById.get(productId);
    items.push({
      id: productId,
      name: String(inv.name || product?.name || ""),
      category: String(inv.subCategory || product?.subCategory || product?.category || ""),
      imageUrl: inv.imageUrl ?? product?.imageUrl ?? null,
      price,
      isAvailable: true,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  const updatedAtMs = Date.now();
  await db.doc(`stores/${storeId}/catalogCache/main`).set({
    updatedAtMs,
    itemCount: items.length,
    items,
  });

  return { itemCount: items.length, updatedAtMs };
}

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
 *
 * @deprecated Superseded by `rebuildCustomerCatalog`, which sources availability
 * and price straight from `inventory.customerEnabled`/`customerPrice` instead of
 * the separate `catalogItems` collection. Kept only until the admin/customer-catalog
 * page and its `catalogItems` data are retired — see docs/superpowers/plans (the
 * "Unify product setup, pricing & availability" initiative) for the cutover order.
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
