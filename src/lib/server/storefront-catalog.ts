import type { Firestore } from "firebase-admin/firestore";
import { loadOptionOverrides, valueKey } from "./option-overrides";

/**
 * Builds the public SharEat website storefront catalog snapshot for one store.
 *
 * Source of truth is the global `products` collection (the `showOnStorefront`
 * flag staff toggle in the product editor) overlaid with this store's
 * `inventory` for pricing + availability. Pricing ALWAYS comes from the store's
 * inventory — products carry no price — and is `onlinePrice ?? sellingPrice`:
 * a branch may charge more online (delivery/packaging) without moving the table
 * price. A product with the flag on but no active, positively-priced inventory
 * record at this store is omitted.
 *
 * Availability is an AND of two gates: the global `showOnStorefront` decides
 * what MAY be sold online, and the branch's `inventory.onlineEnabled` decides
 * whether THIS branch offers it. Only an explicit `false` withholds — see the
 * gate below.
 *
 * The resulting doc at `stores/{storeId}/storefrontCatalog/main` is read by the
 * website's Cloud Function (getStorefrontCatalog) and is also the price
 * authority the order-placement function recomputes against — so it must carry
 * every value's priceDelta. It deliberately carries NO internal fields (cost,
 * kitchen routing, etc.) so it is safe to surface to the public browser.
 *
 * Grouping mirrors the POS: items are grouped by `subCategory`, and a family
 * (`kind:'group'`) lists its sellable `variant` children.
 *
 * Descriptions: an item carries the root product's copy. A variant carries its
 * own only when the family actually uses per-variant copy — the Samgyupsal
 * Sharing Sets, whose five tiers genuinely differ (Set One has no chicken and no
 * Coke; Set Three has both). Families where every tier shares one blurb are
 * unaffected and serialise exactly as before.
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
  /**
   * Only present when the family actually uses per-variant copy — see
   * `DESCRIPTION_MAX` below. When absent, consumers fall back to the parent
   * item's `description`.
   */
  description?: string;
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

/**
 * Hard cap on any single description carried in the snapshot.
 *
 * Bounded, not unbounded: every client downloads this document whole, so one
 * over-long product must not be able to bloat it for everyone. 1000 leaves
 * generous room over the longest real content list (~412 chars, the Samgyupsal
 * Sharing Set tiers) without inviting an essay.
 */
const DESCRIPTION_MAX = 1000;

/**
 * Trims a description to `DESCRIPTION_MAX`, cutting at the last word boundary.
 *
 * The previous 280-char `.slice()` cut mid-word — a Sharing Set tier ended
 * "...100g tteokbokk", which reads as a bug to the customer.
 */
function clampDescription(value: unknown): string {
  const text = String(value ?? "").trim();
  if (text.length <= DESCRIPTION_MAX) return text;
  const cut = text.slice(0, DESCRIPTION_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
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
    // Per-branch online gate. Tested with `=== false`, NOT `!== true`: no live
    // inventory row carries this field yet, so a missing value MUST read as
    // "offered" or every currently published item would vanish on deploy.
    if (x?.onlineEnabled === false) continue;
    const pid = String(x?.productId || "");
    if (pid) invByProductId.set(pid, x);
  }

  /**
   * The price the storefront charges: the branch's `onlinePrice` when it has
   * set one, otherwise the dine-in `sellingPrice`. Only a positive finite
   * number counts as an override — missing/null/0/negative all mean "not set".
   * A non-positive resolved price still means the item is not sellable.
   */
  function resolvePrice(productId: string): number | null {
    const inv = invByProductId.get(String(productId));
    if (!inv) return null;
    const op = Number(inv.onlinePrice ?? 0);
    if (Number.isFinite(op) && op > 0) return op;
    const sp = Number(inv.sellingPrice ?? 0);
    if (!Number.isFinite(sp) || sp <= 0) return null;
    return sp;
  }
  function invImage(productId: string): string | null {
    const inv = invByProductId.get(String(productId));
    return inv?.imageUrl ?? null;
  }

  // --- Option groups (active, non-archived) for embedding modifiers. ---
  // Overlaid with this store's availability overrides so a store only publishes
  // the groups/values it actually carries (e.g. Malvar drops the Cheese dip).
  const overrides = await loadOptionOverrides(db, storeId);
  const ogSnap = await db.collection("optionGroups").get();
  const optionGroupById = new Map<string, StorefrontOptionGroup>();
  for (const d of ogSnap.docs) {
    const g = d.data() as any;
    if (g?.isActive === false || g?.isArchived === true) continue;
    if (overrides.disabledGroupIds.has(d.id)) continue;
    const values: StorefrontModifierValue[] = (Array.isArray(g.values) ? g.values : [])
      .filter((v: any) => v?.isActive !== false)
      .filter((v: any) => !overrides.disabledValueKeys.has(valueKey(d.id, String(v.id))))
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
    const description = clampDescription(p.description);

    if (p.kind === "group") {
      const children = (variantsByGroup.get(String(p.id)) || []).filter(
        (v) => v.isActive !== false && v.isArchived !== true
      );
      // Resolve prices first: a variant with no positive price is not sellable
      // and must not influence anything below it.
      const priced: { v: any; price: number }[] = [];
      for (const v of children) {
        const price = resolvePrice(v.id);
        if (price == null) continue;
        priced.push({ v, price });
      }
      if (priced.length === 0) continue; // nothing sellable here

      // Per-variant copy is carried ONLY when the family actually uses it.
      // Where every variant shares the parent's blurb — the common case — the
      // snapshot serialises exactly as it did before this field existed: no
      // duplicated text, no bloat, no change for existing products.
      const familyUsesVariantCopy = priced.some(({ v }) => clampDescription(v.description).length > 0);

      const variants: StorefrontVariant[] = priced.map(({ v, price }) => {
        const variant: StorefrontVariant = {
          productId: v.id,
          variantLabel: String(v.variantLabel || v.variant || ""),
          displayName: displayNameFor(p.name, v.variantLabel || v.variant),
          price,
          imageUrl: v.imageUrl ?? invImage(v.id) ?? p.imageUrl ?? null,
        };
        if (familyUsesVariantCopy) {
          // Fall back to the root so switching tiers never blanks the panel.
          const own = clampDescription(v.description) || description;
          if (own) variant.description = own;
        }
        return variant;
      });
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
