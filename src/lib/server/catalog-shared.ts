import type { Firestore } from "firebase-admin/firestore";
import { loadOptionOverrides, valueKey } from "./option-overrides";

/**
 * Pieces shared by the two customer-facing catalog projections —
 * `rebuildStorefrontCatalog` (the public website) and `rebuildCustomerCatalog`
 * (the in-store CUSTOMER app).
 *
 * Both read the same two sources (the global `products` collection plus this
 * store's `inventory`) and both must present families, names, blurbs and
 * modifiers to a customer identically. Only their availability gate
 * (`onlineEnabled` vs `customerEnabled`) and their pricing rule differ, so
 * everything except those two decisions lives here.
 */

export type CatalogModifierValue = { id: string; name: string; priceDelta: number };

export type CatalogOptionGroup = {
  id: string;
  name: string;
  selectionMode: "single" | "multi";
  required: boolean;
  minSelections?: number;
  maxSelections?: number;
  values: CatalogModifierValue[];
};

/** e.g. ("Kimbap", "Signature") -> "Kimbap (Signature)". */
export function displayNameFor(name: string, variantLabel?: string | null): string {
  const base = String(name || "").trim();
  const v = String(variantLabel || "").trim();
  return v ? `${base} (${v})` : base;
}

/**
 * Hard cap on any single description carried in a snapshot.
 *
 * Bounded, not unbounded: every client downloads the snapshot document whole,
 * so one over-long product must not be able to bloat it for everyone. 1000
 * leaves generous room over the longest real content list (~412 chars, the
 * Samgyupsal Sharing Set tiers) without inviting an essay.
 */
export const DESCRIPTION_MAX = 1000;

/**
 * Trims a description to `DESCRIPTION_MAX`, cutting at the last word boundary.
 *
 * A previous 280-char `.slice()` cut mid-word — a Sharing Set tier ended
 * "...100g tteokbokk", which reads as a bug to the customer.
 */
export function clampDescription(value: unknown): string {
  const text = String(value ?? "").trim();
  if (text.length <= DESCRIPTION_MAX) return text;
  const cut = text.slice(0, DESCRIPTION_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

/** Anything that may carry an `optionGroupIds` array. */
type GroupBearing = { optionGroupIds?: unknown } | null | undefined;

function idsOf(source: GroupBearing): string[] {
  const raw = source?.optionGroupIds;
  if (!Array.isArray(raw)) return [];
  // Discard blanks BEFORE stringifying — String(null) is "null", which is
  // truthy and would resolve to a group id that cannot exist.
  return raw.filter((x) => x !== null && x !== undefined && x !== "").map((x) => String(x));
}

/**
 * The option groups attached to one sellable item, from all three layers.
 *
 *   parent (the family root)  ∪  the item itself  ∪  this store's inventory row
 *
 * Union, not replace, and de-duplicated preserving first-seen order — which is
 * the attachment order the admin controls with the ↑↓ arrows.
 *
 * The layers answer different questions and all three are legitimate at once:
 * the parent carries what the whole family offers, a variant adds what only it
 * offers (Extra Nori on Signature but not Veggies), and the inventory row adds
 * what one branch offers without touching the global catalog every other branch
 * shares.
 *
 * Store-level *disables* are NOT applied here — `loadStoreOptionGroups` drops
 * them when it resolves ids to groups, so a group one store attaches can still
 * be withheld by another.
 *
 * This mirrors what `api/products/[id]/option-groups` has always done for the
 * cashier (parent ∪ variant); it exists so the cashier, the storefront and the
 * customer app cannot answer this question three different ways.
 */
export function resolveOptionGroupIds(
  product: GroupBearing,
  parent?: GroupBearing,
  inventoryRow?: GroupBearing
): string[] {
  return Array.from(new Set([...idsOf(parent), ...idsOf(product), ...idsOf(inventoryRow)]));
}

/**
 * Maps a product's `optionGroupIds` to the option groups this store actually
 * carries, or `undefined` when it attaches none that survive.
 */
export type OptionGroupResolver = (ids: unknown) => CatalogOptionGroup[] | undefined;

/**
 * Reads the global `optionGroups` collection once and overlays this store's
 * availability overrides, so a store only ever publishes the groups and values
 * it really carries (e.g. Malvar drops the Cheese dip). Returns a resolver
 * closed over that index.
 *
 * A group left with no active values is dropped entirely — an unsatisfiable
 * required group would block ordering.
 */
export async function loadStoreOptionGroups(db: Firestore, storeId: string): Promise<OptionGroupResolver> {
  const overrides = await loadOptionOverrides(db, storeId);
  const ogSnap = await db.collection("optionGroups").get();

  const optionGroupById = new Map<string, CatalogOptionGroup>();
  for (const d of ogSnap.docs) {
    const g = d.data() as any;
    if (g?.isActive === false || g?.isArchived === true) continue;
    if (overrides.disabledGroupIds.has(d.id)) continue;

    const values: CatalogModifierValue[] = (Array.isArray(g.values) ? g.values : [])
      .filter((v: any) => v?.isActive !== false)
      .filter((v: any) => !overrides.disabledValueKeys.has(valueKey(d.id, String(v.id))))
      .sort((a: any, b: any) => Number(a?.sortOrder ?? 0) - Number(b?.sortOrder ?? 0))
      .map((v: any) => ({ id: String(v.id), name: String(v.name), priceDelta: Number(v.priceDelta ?? 0) }));
    if (values.length === 0) continue;

    const og: CatalogOptionGroup = {
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

  return (ids: unknown) => {
    if (!Array.isArray(ids) || ids.length === 0) return undefined;
    const out: CatalogOptionGroup[] = [];
    for (const id of ids) {
      const g = optionGroupById.get(String(id));
      if (g) out.push(g);
    }
    return out.length ? out : undefined;
  };
}
