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
