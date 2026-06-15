import type { Firestore } from "firebase-admin/firestore";

/**
 * Builds the public SharEat website storefront catalog snapshot for one store.
 *
 * Source of truth is the global `products` collection (the `showOnStorefront`
 * flag staff toggle in the product editor) overlaid with this store's
 * `inventory` for pricing + availability. Pricing ALWAYS comes from the store's
 * inventory.sellingPrice — products carry no price. A product with the flag on
 * but no active, positively-priced inventory record at this store is omitted.
 *
 * The resulting doc at `stores/{storeId}/storefrontCatalog/main` is read by the
 * website's Cloud Function (getStorefrontCatalog) and is also the price
 * authority the order-placement function recomputes against — so it must carry
 * every value's priceDelta. It deliberately carries NO internal fields (cost,
 * kitchen routing, etc.) so it is safe to surface to the public browser.
 *
 * Grouping mirrors the POS: items are grouped by `subCategory`, and a family
 * (`kind:'group'`) lists its sellable `variant` children.
 */

export type StorefrontModifierValue = { id: string; name: string; priceDelta: number };
export type StorefrontOptionGroup = {
  id: string;
  name: string;
  selectionMode: "single" | "multi";
  required: boolean;
  minSelections?: number;
  maxSelections?: number;
  values: StorefrontModifierValue[];
};
export type StorefrontVariant = {
  productId: string;
  variantLabel: string;
  displayName: string;
  price: number;
  imageUrl: string | null;
};
export type StorefrontItem = {
  productId: string;
  name: string;
  displayName: string;
  description?: string;
  subCategory: string;
  imageUrl: string | null;
  kind: "single" | "group";
  price: number; // single: its price; group: lowest variant price ("from")
  variants?: StorefrontVariant[];
  optionGroups?: StorefrontOptionGroup[];
};
export type StorefrontCategory = { name: string; items: StorefrontItem[] };
export type StorefrontCatalog = {
  storeId: string;
  currency: "PHP";
  updatedAtMs: number;
  itemCount: number;
  categories: StorefrontCategory[];
};

function displayNameFor(name: string, variantLabel?: string | null): string {
  const base = String(name || "").trim();
  const v = String(variantLabel || "").trim();
  return v ? `${base} (${v})` : base;
}

export async function rebuildStorefrontCatalog(
  db: Firestore,
  storeId: string
): Promise<{ itemCount: number; updatedAtMs: number }> {
  if (!storeId) throw new Error("storeId required.");

  // --- Read all products once (avoids composite-index requirements). ---
  const productsSnap = await db.collection("products").get();
  const allProducts = productsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  const variantsByGroup = new Map<string, any[]>();
  for (const p of allProducts) {
    if (p.kind === "variant" && p.groupId) {
      const arr = variantsByGroup.get(String(p.groupId)) || [];
      arr.push(p);
      variantsByGroup.set(String(p.groupId), arr);
    }
  }

  // --- Per-store inventory keyed by productId: price + availability source. ---
  const invSnap = await db.collection(`stores/${storeId}/inventory`).get();
  const invByProductId = new Map<string, any>();
  for (const d of invSnap.docs) {
    const x = d.data() as any;
    if (x?.isActive === false) continue;
    if (x?.isArchived === true) continue;
    const pid = String(x?.productId || "");
    if (pid) invByProductId.set(pid, x);
  }

  function resolvePrice(productId: string): number | null {
    const inv = invByProductId.get(String(productId));
    if (!inv) return null;
    const sp = Number(inv.sellingPrice ?? 0);
    if (!Number.isFinite(sp) || sp <= 0) return null;
    return sp;
  }
  function invImage(productId: string): string | null {
    const inv = invByProductId.get(String(productId));
    return inv?.imageUrl ?? null;
  }

  // --- Option groups (active, non-archived) for embedding modifiers. ---
  const ogSnap = await db.collection("optionGroups").get();
  const optionGroupById = new Map<string, StorefrontOptionGroup>();
  for (const d of ogSnap.docs) {
    const g = d.data() as any;
    if (g?.isActive === false || g?.isArchived === true) continue;
    const values: StorefrontModifierValue[] = (Array.isArray(g.values) ? g.values : [])
      .filter((v: any) => v?.isActive !== false)
      .sort((a: any, b: any) => Number(a?.sortOrder ?? 0) - Number(b?.sortOrder ?? 0))
      .map((v: any) => ({ id: String(v.id), name: String(v.name), priceDelta: Number(v.priceDelta ?? 0) }));
    if (values.length === 0) continue;
    const og: StorefrontOptionGroup = {
      id: d.id,
      name: String(g.name || ""),
      selectionMode: g.selectionMode === "multi" ? "multi" : "single",
      required: !!g.required,
      values,
    };
    if (g.minSelections != null) og.minSelections = Number(g.minSelections);
    if (g.maxSelections != null) og.maxSelections = Number(g.maxSelections);
    optionGroupById.set(d.id, og);
  }
  function resolveOptionGroups(ids: any): StorefrontOptionGroup[] | undefined {
    if (!Array.isArray(ids) || ids.length === 0) return undefined;
    const out: StorefrontOptionGroup[] = [];
    for (const id of ids) {
      const g = optionGroupById.get(String(id));
      if (g) out.push(g);
    }
    return out.length ? out : undefined;
  }

  // --- Build storefront items from flagged root products. ---
  const items: StorefrontItem[] = [];
  for (const p of allProducts) {
    if (p.showOnStorefront !== true) continue;
    if (p.isActive === false) continue;
    if (p.isArchived === true) continue;
    if (p.kind === "variant") continue; // variants surface via their parent group

    const subCategory = String(p.subCategory || "Uncategorized");
    const optionGroups = resolveOptionGroups(p.optionGroupIds);
    const description = String(p.description || "").trim().slice(0, 280);

    if (p.kind === "group") {
      const children = (variantsByGroup.get(String(p.id)) || []).filter(
        (v) => v.isActive !== false && v.isArchived !== true
      );
      const variants: StorefrontVariant[] = [];
      for (const v of children) {
        const price = resolvePrice(v.id);
        if (price == null) continue;
        variants.push({
          productId: v.id,
          variantLabel: String(v.variantLabel || v.variant || ""),
          displayName: displayNameFor(p.name, v.variantLabel || v.variant),
          price,
          imageUrl: v.imageUrl ?? invImage(v.id) ?? p.imageUrl ?? null,
        });
      }
      if (variants.length === 0) continue; // nothing sellable here
      variants.sort((a, b) => a.price - b.price);
      const item: StorefrontItem = {
        productId: p.id,
        name: String(p.name || ""),
        displayName: String(p.name || ""),
        subCategory,
        imageUrl: p.imageUrl ?? null,
        kind: "group",
        price: variants[0].price,
        variants,
      };
      // Only attach optional fields when present — Firestore rejects `undefined`.
      if (optionGroups) item.optionGroups = optionGroups;
      if (description) item.description = description;
      items.push(item);
    } else {
      // single SKU
      const price = resolvePrice(p.id);
      if (price == null) continue;
      const item: StorefrontItem = {
        productId: p.id,
        name: String(p.name || ""),
        displayName: displayNameFor(p.name, p.variant),
        subCategory,
        imageUrl: p.imageUrl ?? invImage(p.id) ?? null,
        kind: "single",
        price,
      };
      if (optionGroups) item.optionGroups = optionGroups;
      if (description) item.description = description;
      items.push(item);
    }
  }

  // --- Group by subCategory. ---
  const byCat = new Map<string, StorefrontItem[]>();
  for (const it of items) {
    const arr = byCat.get(it.subCategory) || [];
    arr.push(it);
    byCat.set(it.subCategory, arr);
  }
  const categories: StorefrontCategory[] = [...byCat.entries()]
    .map(([name, arr]) => ({
      name,
      items: arr.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const updatedAtMs = Date.now();
  const snapshot: StorefrontCatalog = {
    storeId,
    currency: "PHP",
    updatedAtMs,
    itemCount: items.length,
    categories,
  };

  await db.doc(`stores/${storeId}/storefrontCatalog/main`).set(snapshot);

  return { itemCount: items.length, updatedAtMs };
}
