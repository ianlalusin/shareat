import type { Firestore } from "firebase-admin/firestore";
import {
  clampDescription,
  displayNameFor,
  loadStoreOptionGroups,
  resolveOptionGroupIds,
  type CatalogOptionGroup,
} from "./catalog-shared";
import { getStoreInventoryRows } from "./store-inventory-cache";

/**
 * Rebuilds the per-store CUSTOMER app catalog snapshot from the global
 * `products` collection and this store's `inventory` — the same two
 * collections `rebuildStorefrontCatalog` (storefront-catalog.ts) reads, and now
 * with the same family-aware shape.
 *
 * Visibility is store-scoped and opt-in: `inventory.customerEnabled === true`
 * is the ONLY gate. A missing value means NOT offered.
 *
 * Pricing is always `sellingPrice` — unlike Online, there is no separate
 * customer-app price to set, so the two can never drift apart. An item with no
 * positive `sellingPrice` is omitted rather than shown at ₱0.
 *
 * This is a pure projection with no state of its own: every rebuild fully
 * replaces the document. All editing happens on the inventory record itself,
 * via the manager inventory page.
 *
 * ## Families
 *
 * This builder used to flatten families deliberately — every sellable row, a
 * single product or one variant, became its own item. Because the flat row was
 * also named from `inventory.name` (the FAMILY name, with no variant label),
 * the three Kimbap variants reached the diner as three identical "Kimbap"
 * tiles. Now a family (`kind: "group"`) is emitted once, carrying its sellable
 * `variant` children, exactly as the storefront does.
 *
 * ## Two shapes, on purpose
 *
 * The document carries BOTH `categories` (grouped) and `items` (the legacy
 * flat array). POS and CUSTOMER deploy independently, so a POS release must not
 * break the CUSTOMER build that is already live. The flat array keeps that
 * build working — and its `name` is now the disambiguated display name, so it
 * improves even before CUSTOMER ships. Drop `items` once the new CUSTOMER build
 * is live everywhere.
 */

/** Legacy flat row. Superseded by `CustomerCatalogCategory`; see above. */
export type CustomerCatalogItem = {
  id: string; // POS productId — the CUSTOMER app only uses this as a display key.
  name: string;
  category: string;
  imageUrl: string | null;
  price: number;
  isAvailable: true; // withheld items are simply absent from the array.
};

export type CustomerCatalogVariant = {
  productId: string;
  variantLabel: string;
  displayName: string;
  price: number;
  imageUrl: string | null;
  /** True only when this store both offers AND sells this variant — see `orderable` below. */
  orderable: boolean;
  kitchenLocationId?: string | null;
  kitchenLocationName?: string | null;
  /**
   * This variant's own modifier set, present ONLY when it differs from the
   * family's. Read it as `variant.optionGroups ?? entry.optionGroups`.
   */
  optionGroups?: CatalogOptionGroup[];
  /**
   * Only present when the family actually uses per-variant copy — see
   * `DESCRIPTION_MAX` in `catalog-shared.ts`. When absent, consumers fall back
   * to the parent entry's `description`.
   */
  description?: string;
};

export type CustomerCatalogEntry = {
  productId: string;
  name: string;
  displayName: string;
  description?: string;
  subCategory: string;
  imageUrl: string | null;
  kind: "single" | "group";
  price: number; // single: its price; group: lowest variant price ("from")
  /**
   * Whether a diner may order this themselves.
   *
   * Requires `isAddon` on top of `customerEnabled`. `isAddon` is the flag the
   * manager inventory dialog refuses to set without a positive `sellingPrice`
   * AND a `kitchenLocationId`, so every orderable item is priceable and
   * routable by construction — no separate validation, and no way to order
   * something the kitchen would never see. A family is orderable when any of
   * its variants is.
   *
   * Items that are visible but not orderable stay on the menu as browse-only,
   * so switching this on never removes anything from the diner's view.
   */
  orderable: boolean;
  kitchenLocationId?: string | null;
  kitchenLocationName?: string | null;
  variants?: CustomerCatalogVariant[];
  optionGroups?: CatalogOptionGroup[];
};

export type CustomerCatalogCategory = { name: string; items: CustomerCatalogEntry[] };

export type CustomerCatalog = {
  storeId: string;
  currency: "PHP";
  updatedAtMs: number;
  itemCount: number;
  /**
   * The store-level kill switch for diner self-ordering
   * (`stores/{storeId}.customerOrderingEnabled`).
   *
   * Opt-in and separate from per-item `orderable`, so a branch can adopt
   * self-ordering on its own schedule without re-tagging inventory, and can
   * switch it back off during a rush without a deploy. The client needs BOTH
   * this and the item's own `orderable` before it offers an Add button.
   */
  orderingEnabled: boolean;
  categories: CustomerCatalogCategory[];
  items: CustomerCatalogItem[];
};

export async function rebuildCustomerCatalog(
  db: Firestore,
  storeId: string
): Promise<{ itemCount: number; updatedAtMs: number }> {
  if (!storeId) throw new Error("storeId required.");

  // Store-level self-ordering switch. Opt-in: absent means off, so shipping
  // this builder never turns ordering on for a branch that didn't ask for it.
  const storeSnap = await db.doc(`stores/${storeId}`).get();
  const orderingEnabled = (storeSnap.data() as any)?.customerOrderingEnabled === true;

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
  const invRows = await getStoreInventoryRows(db, storeId);
  const invByProductId = new Map<string, any>();
  for (const row of invRows) {
    const x = row.data as any;
    if (x?.isActive === false) continue;
    if (x?.isArchived === true) continue;
    // The customer-app gate. Opt-in and per-branch: only an explicit `true`
    // publishes, so a store's internal inventory can never leak onto the
    // diner's menu by default.
    if (x?.customerEnabled !== true) continue;
    const pid = String(x?.productId || "");
    if (pid) invByProductId.set(pid, x);
  }

  /** The table price, or null when this store cannot sell the item. */
  function resolvePrice(productId: string): number | null {
    const inv = invByProductId.get(String(productId));
    if (!inv) return null;
    const sp = Number(inv.sellingPrice ?? 0);
    if (!Number.isFinite(sp) || sp <= 0) return null;
    return sp;
  }

  /**
   * This store's LOCAL photo override for a product, or null.
   *
   * `inventory.imageUrl` is a pure override: absent/null means "this store has
   * no photo of its own, use the global catalog photo" — it is never populated
   * as a copy of `products/{id}.imageUrl`. So the display rule everywhere is
   * `inventoryItem.imageUrl ?? product.imageUrl`, local first.
   */
  function invImage(productId: string): string | null {
    const inv = invByProductId.get(String(productId));
    return inv?.imageUrl ?? null;
  }

  /**
   * Kitchen routing for an item, and whether a diner may order it.
   *
   * `isAddon` is trusted to imply a kitchen location, but verified anyway: a
   * row that lost its station through an import or a partial edit must degrade
   * to browse-only rather than produce an order no station ever receives.
   */
  function resolveOrdering(productId: string): {
    orderable: boolean;
    kitchenLocationId: string | null;
    kitchenLocationName: string | null;
  } {
    const inv = invByProductId.get(String(productId));
    const kitchenLocationId = inv?.kitchenLocationId ?? null;
    return {
      orderable: inv?.isAddon === true && !!kitchenLocationId,
      kitchenLocationId,
      kitchenLocationName: inv?.kitchenLocationName ?? null,
    };
  }

  // --- Option groups (active, non-archived), overlaid with this store's
  // availability overrides so it only publishes what it actually carries. ---
  const resolveOptionGroups = await loadStoreOptionGroups(db, storeId);

  /**
   * The option groups for one variant, but ONLY when they differ from what the
   * family already publishes.
   *
   * Consumers read `variant.optionGroups ?? entry.optionGroups`, so the full
   * list is carried rather than just the extras — a merge at the consumption
   * sites (one of which prices real orders) is a bug waiting to happen, and the
   * duplication only costs anything for the rare variant that actually differs.
   */
  function variantOptionGroups(v: any, parent: any, familyIds: Set<string>) {
    const inv = invByProductId.get(String(v.id));
    const ids = resolveOptionGroupIds(v, parent, inv);
    const differs = ids.length !== familyIds.size || ids.some((id) => !familyIds.has(id));
    return differs ? resolveOptionGroups(ids) : undefined;
  }

  // --- Build entries from root products; variants surface via their parent. ---
  const entries: CustomerCatalogEntry[] = [];
  for (const p of allProducts) {
    if (p.isActive === false) continue;
    if (p.isArchived === true) continue;
    if (p.kind === "variant") continue;

    const subCategory = String(p.subCategory || p.category || "Uncategorized");
    // Family/shared set. A single product also picks up whatever its own
    // store attached, which is why the inventory row is passed here.
    const optionGroups = resolveOptionGroups(
      resolveOptionGroupIds(p, null, p.kind === "group" ? null : invByProductId.get(String(p.id)))
    );
    const familyGroupIds = new Set((optionGroups ?? []).map((g) => g.id));
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

      // Per-variant copy is carried ONLY when the family actually uses it, so
      // families where every tier shares one blurb carry no duplicated text.
      const familyUsesVariantCopy = priced.some(({ v }) => clampDescription(v.description).length > 0);

      const variants: CustomerCatalogVariant[] = priced.map(({ v, price }) => {
        const ordering = resolveOrdering(v.id);
        const variant: CustomerCatalogVariant = {
          productId: v.id,
          variantLabel: String(v.variantLabel || v.variant || ""),
          displayName: displayNameFor(p.name, v.variantLabel || v.variant),
          price,
          // Local override first, then the variant's own global photo, then
          // the family root's.
          imageUrl: invImage(v.id) ?? v.imageUrl ?? p.imageUrl ?? null,
          orderable: ordering.orderable,
          kitchenLocationId: ordering.kitchenLocationId,
          kitchenLocationName: ordering.kitchenLocationName,
        };
        if (familyUsesVariantCopy) {
          // Fall back to the root so switching tiers never blanks the panel.
          const own = clampDescription(v.description) || description;
          if (own) variant.description = own;
        }
        const ownGroups = variantOptionGroups(v, p, familyGroupIds);
        if (ownGroups) variant.optionGroups = ownGroups;
        return variant;
      });

      const entry: CustomerCatalogEntry = {
        productId: p.id,
        name: String(p.name || ""),
        displayName: String(p.name || ""),
        subCategory,
        // A family root normally has no inventory row of its own (a store
        // carries the variants, not the group), so this resolves to the global
        // photo in practice; it is here so a store that DOES carry a root row
        // is not silently ignored.
        imageUrl: invImage(p.id) ?? p.imageUrl ?? null,
        kind: "group",
        price: Math.min(...variants.map((v) => v.price)),
        orderable: variants.some((v) => v.orderable),
        variants,
      };
      // Only attach optional fields when present — Firestore rejects `undefined`.
      if (optionGroups) entry.optionGroups = optionGroups;
      if (description) entry.description = description;
      entries.push(entry);
    } else {
      // single SKU
      const price = resolvePrice(p.id);
      if (price == null) continue;
      const ordering = resolveOrdering(p.id);
      const entry: CustomerCatalogEntry = {
        productId: p.id,
        name: String(p.name || ""),
        displayName: displayNameFor(p.name, p.variantLabel || p.variant),
        subCategory,
        imageUrl: invImage(p.id) ?? p.imageUrl ?? null,
        kind: "single",
        price,
        orderable: ordering.orderable,
        kitchenLocationId: ordering.kitchenLocationId,
        kitchenLocationName: ordering.kitchenLocationName,
      };
      if (optionGroups) entry.optionGroups = optionGroups;
      if (description) entry.description = description;
      entries.push(entry);
    }
  }

  // --- Group by subCategory. ---
  const byCat = new Map<string, CustomerCatalogEntry[]>();
  for (const e of entries) {
    const arr = byCat.get(e.subCategory) || [];
    arr.push(e);
    byCat.set(e.subCategory, arr);
  }
  const categories: CustomerCatalogCategory[] = [...byCat.entries()]
    .map(([name, arr]) => ({
      name,
      items: arr.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // --- Legacy flat array, for the CUSTOMER build that is already live. ---
  const items: CustomerCatalogItem[] = [];
  for (const e of entries) {
    if (e.kind === "group") {
      for (const v of e.variants ?? []) {
        items.push({
          id: v.productId,
          name: v.displayName,
          category: e.subCategory,
          imageUrl: v.imageUrl,
          price: v.price,
          isAvailable: true,
        });
      }
    } else {
      items.push({
        id: e.productId,
        name: e.displayName,
        category: e.subCategory,
        imageUrl: e.imageUrl,
        price: e.price,
        isAvailable: true,
      });
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));

  const updatedAtMs = Date.now();
  const snapshot: CustomerCatalog = {
    storeId,
    currency: "PHP",
    updatedAtMs,
    itemCount: items.length,
    orderingEnabled,
    categories,
    items,
  };

  await db.doc(`stores/${storeId}/catalogCache/main`).set(snapshot);

  return { itemCount: items.length, updatedAtMs };
}
