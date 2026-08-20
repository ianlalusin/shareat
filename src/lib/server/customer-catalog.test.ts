import { describe, it, expect } from "vitest";
import {
  rebuildCustomerCatalog,
  type CustomerCatalogItem,
  type CustomerCatalogCategory,
} from "@/lib/server/customer-catalog";

/**
 * Minimal in-memory stand-in for the Admin SDK surface the builder touches.
 * Nothing reaches Firestore: the final `.set()` is captured, not sent.
 */
function fakeDb(opts: { products: any[]; inventory: any[]; optionGroups?: any[]; optionOverrides?: any | null }) {
  const written: { path: string; data: any }[] = [];
  const coll = (docs: any[]) => ({ get: async () => ({ docs: docs.map((d) => ({ id: d.id, data: () => d })) }) });
  const db: any = {
    collection(path: string) {
      if (path === "products") return coll(opts.products);
      if (path === "optionGroups") return coll(opts.optionGroups ?? []);
      if (/\/inventory$/.test(path)) return coll(opts.inventory);
      return coll([]);
    },
    doc(path: string) {
      return {
        get: async () => {
          if (/optionOverrides/.test(path)) {
            const exists = !!opts.optionOverrides;
            return { exists, data: () => opts.optionOverrides, get: (f: string) => opts.optionOverrides?.[f] };
          }
          // Everything else (notably stores/{id}/inventoryCache/main, the
          // shared inventory-scan cache from getStoreInventoryRows) is always
          // a cold cache here — every test exercises a fresh scan.
          return { exists: false, data: () => undefined, get: () => undefined };
        },
        set: async (data: any) => { written.push({ path, data }); },
      };
    },
  };
  return { db, written };
}

const STORE = "STORE_X";

/**
 * A store inventory row. `customerEnabled: true` is the baseline — visibility
 * is opt-in. `isAddon` is deliberately NOT part of the baseline: it is the
 * separate, stricter gate that makes an item directly orderable.
 */
const inv = (productId: string, sellingPrice: number, over: Record<string, any> = {}) => ({
  id: `i_${productId}`,
  productId,
  sellingPrice,
  isActive: true,
  isArchived: false,
  customerEnabled: true,
  ...over,
});

/** An inventory row for an item the diner may order themselves. */
const orderableInv = (productId: string, sellingPrice: number, over: Record<string, any> = {}) =>
  inv(productId, sellingPrice, { isAddon: true, kitchenLocationId: "kds_main", kitchenLocationName: "Main Kitchen", ...over });

const product = (id: string, over: Record<string, any> = {}): Record<string, any> => ({
  id,
  name: `Product ${id}`,
  subCategory: "Uncategorized",
  isActive: true,
  isArchived: false,
  ...over,
});

/** A Kimbap family: one group root plus N variants sharing its groupId. */
function kimbap(labels: string[], over: { root?: any; variant?: any } = {}) {
  const root = product("grp", { kind: "group", name: "Kimbap", subCategory: "Sides", ...over.root });
  const variants = labels.map((label, i) =>
    product(`v${i + 1}`, { kind: "variant", groupId: "grp", name: "Kimbap", subCategory: "Sides", variantLabel: label, ...over.variant })
  );
  return { root, variants, products: [root, ...variants] };
}

async function build(opts: Parameters<typeof fakeDb>[0]): Promise<{
  items: CustomerCatalogItem[];
  categories: CustomerCatalogCategory[];
  itemCount: number;
}> {
  const { db, written } = fakeDb(opts);
  await rebuildCustomerCatalog(db, STORE);
  // Also writes stores/{STORE}/inventoryCache/main (the shared inventory-scan
  // cache from getStoreInventoryRows) — filter to the doc this suite tests.
  const catalogWrite = written.find((w) => w.path === `stores/${STORE}/catalogCache/main`);
  expect(catalogWrite).toBeDefined();
  return catalogWrite!.data;
}

/** Every entry across every category, flattened. */
const allEntries = (categories: CustomerCatalogCategory[]) => categories.flatMap((c) => c.items);

describe("rebuildCustomerCatalog — availability gate", () => {
  it("publishes an inventory row with customerEnabled true", async () => {
    const p = product("p1", { name: "Samgyupsal" });
    const { categories } = await build({ products: [p], inventory: [inv("p1", 250)] });
    const entries = allEntries(categories);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ productId: "p1", name: "Samgyupsal", price: 250, kind: "single" });
  });

  it("omits a row missing customerEnabled (opt-in, not opt-out)", async () => {
    const p = product("p1");
    const { categories } = await build({ products: [p], inventory: [inv("p1", 250, { customerEnabled: undefined })] });
    expect(allEntries(categories)).toHaveLength(0);
  });

  it("omits a row with customerEnabled explicitly false", async () => {
    const p = product("p1");
    const { categories } = await build({ products: [p], inventory: [inv("p1", 250, { customerEnabled: false })] });
    expect(allEntries(categories)).toHaveLength(0);
  });

  it("always charges the store's sellingPrice — there is no separate customer price", async () => {
    const p = product("p1");
    const { categories } = await build({ products: [p], inventory: [inv("p1", 300)] });
    expect(allEntries(categories)[0].price).toBe(300);
  });

  it("withholds the item when sellingPrice is 0 or negative rather than showing it free", async () => {
    const p = product("p1");
    const zero = await build({ products: [p], inventory: [inv("p1", 0)] });
    expect(allEntries(zero.categories)).toHaveLength(0);
    const negative = await build({ products: [p], inventory: [inv("p1", -5)] });
    expect(allEntries(negative.categories)).toHaveLength(0);
  });

  it("omits inactive or archived inventory rows even when customerEnabled", async () => {
    const p = product("p1");
    const inactive = await build({ products: [p], inventory: [inv("p1", 250, { isActive: false })] });
    expect(allEntries(inactive.categories)).toHaveLength(0);
    const archived = await build({ products: [p], inventory: [inv("p1", 250, { isArchived: true })] });
    expect(allEntries(archived.categories)).toHaveLength(0);
  });

  it("omits an inactive or archived product even when the store stocks it", async () => {
    const dead = product("p1", { isActive: false });
    const { categories } = await build({ products: [dead], inventory: [inv("p1", 250)] });
    expect(allEntries(categories)).toHaveLength(0);
  });
});

describe("rebuildCustomerCatalog — variant families", () => {
  it("collapses three Kimbap variants into ONE family entry instead of three lookalike rows", async () => {
    const { products, variants } = kimbap(["Veggies", "Signature", "Spicy"]);
    const { categories } = await build({
      products,
      inventory: variants.map((v, i) => inv(v.id, 100 + i * 10)),
    });
    const entries = allEntries(categories);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ productId: "grp", name: "Kimbap", kind: "group" });
    expect(entries[0].variants?.map((v) => v.variantLabel)).toEqual(["Veggies", "Signature", "Spicy"]);
  });

  it("prices a family from its cheapest sellable variant", async () => {
    const { products, variants } = kimbap(["Veggies", "Signature"]);
    const { categories } = await build({
      products,
      inventory: [inv(variants[0].id, 180), inv(variants[1].id, 120)],
    });
    expect(allEntries(categories)[0].price).toBe(120);
  });

  it("gives every variant a disambiguating displayName", async () => {
    const { products, variants } = kimbap(["Veggies", "Signature"]);
    const { categories } = await build({ products, inventory: variants.map((v) => inv(v.id, 150)) });
    expect(allEntries(categories)[0].variants?.map((v) => v.displayName)).toEqual([
      "Kimbap (Veggies)",
      "Kimbap (Signature)",
    ]);
  });

  it("drops variants the store does not offer, keeping the rest of the family", async () => {
    const { products, variants } = kimbap(["Veggies", "Signature", "Spicy"]);
    const { categories } = await build({
      products,
      // Only the first and third are offered here.
      inventory: [inv(variants[0].id, 150), inv(variants[2].id, 170)],
    });
    const entry = allEntries(categories)[0];
    expect(entry.variants?.map((v) => v.variantLabel)).toEqual(["Veggies", "Spicy"]);
  });

  it("omits the whole family when no variant is sellable here", async () => {
    const { products, variants } = kimbap(["Veggies", "Signature"]);
    const { categories } = await build({
      products,
      inventory: variants.map((v) => inv(v.id, 150, { customerEnabled: false })),
    });
    expect(allEntries(categories)).toHaveLength(0);
  });

  it("never emits a bare group root as its own orderable row", async () => {
    const { products, variants } = kimbap(["Veggies"]);
    const { categories } = await build({
      products,
      // A store that (wrongly) carries an inventory row for the group root too.
      inventory: [inv("grp", 999), inv(variants[0].id, 150)],
    });
    const entries = allEntries(categories);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("group");
    expect(entries[0].price).toBe(150);
  });

  it("carries per-variant copy only when the family actually uses it", async () => {
    const shared = kimbap(["Veggies", "Signature"]);
    const noCopy = await build({ products: shared.products, inventory: shared.variants.map((v) => inv(v.id, 150)) });
    expect(allEntries(noCopy.categories)[0].variants?.every((v) => v.description === undefined)).toBe(true);

    const withCopy = kimbap(["Veggies", "Signature"]);
    withCopy.variants[0].description = "Packed with veggies.";
    const copied = await build({
      products: withCopy.products,
      inventory: withCopy.variants.map((v) => inv(v.id, 150)),
    });
    expect(allEntries(copied.categories)[0].variants?.[0].description).toBe("Packed with veggies.");
  });
});

describe("rebuildCustomerCatalog — orderability", () => {
  it("marks an item orderable only when it is BOTH customerEnabled and isAddon", async () => {
    const p = product("p1");
    const browseOnly = await build({ products: [p], inventory: [inv("p1", 250)] });
    expect(allEntries(browseOnly.categories)[0].orderable).toBe(false);

    const orderable = await build({ products: [p], inventory: [orderableInv("p1", 250)] });
    expect(allEntries(orderable.categories)[0].orderable).toBe(true);
  });

  it("carries kitchen routing for orderable items so the order route need not re-read inventory", async () => {
    const p = product("p1");
    const { categories } = await build({ products: [p], inventory: [orderableInv("p1", 250)] });
    expect(allEntries(categories)[0]).toMatchObject({
      kitchenLocationId: "kds_main",
      kitchenLocationName: "Main Kitchen",
    });
  });

  it("treats a family as orderable when any single variant is", async () => {
    const { products, variants } = kimbap(["Veggies", "Signature"]);
    const { categories } = await build({
      products,
      inventory: [inv(variants[0].id, 150), orderableInv(variants[1].id, 170)],
    });
    const entry = allEntries(categories)[0];
    expect(entry.orderable).toBe(true);
    expect(entry.variants?.map((v) => v.orderable)).toEqual([false, true]);
  });

  it("refuses to mark an item orderable without a kitchen location, even if isAddon slipped through", async () => {
    const p = product("p1");
    const { categories } = await build({
      products: [p],
      inventory: [orderableInv("p1", 250, { kitchenLocationId: null })],
    });
    expect(allEntries(categories)[0].orderable).toBe(false);
  });
});

describe("rebuildCustomerCatalog — inventory doc id", () => {
  it("carries the inventory DOC id, which is not the product id", async () => {
    // The fixture's doc id is `i_p1` while productId is `p1` — mirroring real
    // data, where the two never match. POS bill lines and sold-items analytics
    // key on the doc id, so the snapshot must carry it.
    const p = product("p1");
    const { categories } = await build({ products: [p], inventory: [orderableInv("p1", 250)] });
    expect(allEntries(categories)[0].inventoryId).toBe("i_p1");
  });

  it("carries each variant's own inventory doc id", async () => {
    const { products, variants } = kimbap(["Veggies", "Signature"]);
    const { categories } = await build({
      products,
      inventory: variants.map((v) => orderableInv(v.id, 150)),
    });
    expect(allEntries(categories)[0].variants?.map((v) => v.inventoryId)).toEqual(["i_v1", "i_v2"]);
  });
});

describe("rebuildCustomerCatalog — categories and modifiers", () => {
  it("groups entries by subCategory, sorted, with items sorted by display name", async () => {
    const drink = product("d1", { name: "Iced Tea", subCategory: "Drinks" });
    const stew = product("s1", { name: "Kimchi Jjigae", subCategory: "Stews" });
    const drink2 = product("d2", { name: "Coke", subCategory: "Drinks" });
    const { categories } = await build({
      products: [drink, stew, drink2],
      inventory: [inv("d1", 60), inv("s1", 300), inv("d2", 50)],
    });
    expect(categories.map((c) => c.name)).toEqual(["Drinks", "Stews"]);
    expect(categories[0].items.map((i) => i.displayName)).toEqual(["Coke", "Iced Tea"]);
  });

  it("falls back to Uncategorized when a product has no subCategory", async () => {
    const p = product("p1", { subCategory: undefined, category: undefined });
    const { categories } = await build({ products: [p], inventory: [inv("p1", 100)] });
    expect(categories[0].name).toBe("Uncategorized");
  });

  it("carries a variant's own option groups only when they differ from the family's", async () => {
    const { products, variants } = kimbap(["Veggies", "Signature"]);
    products[0].optionGroupIds = ["og_dip"];          // family: Dip
    variants[1].optionGroupIds = ["og_nori"];          // Signature also gets Nori
    const optionGroups = [
      { id: "og_dip", name: "Dip", values: [{ id: "cheese", name: "Cheese", priceDelta: 0 }] },
      { id: "og_nori", name: "Extra Nori", values: [{ id: "nori", name: "Nori", priceDelta: 20 }] },
    ];
    const { categories } = await build({
      products,
      inventory: variants.map((v) => orderableInv(v.id, 150)),
      optionGroups,
    });
    const entry = allEntries(categories)[0];

    // The shared set stays at family level and is NOT duplicated onto Veggies.
    expect(entry.optionGroups?.map((g) => g.id)).toEqual(["og_dip"]);
    expect(entry.variants?.[0].optionGroups).toBeUndefined();

    // Signature carries the FULL resolved list, so consumers never merge.
    expect(entry.variants?.[1].optionGroups?.map((g) => g.id)).toEqual(["og_dip", "og_nori"]);
  });

  it("leaves every variant bare when the whole family shares one set", async () => {
    const { products, variants } = kimbap(["Veggies", "Signature"]);
    products[0].optionGroupIds = ["og_dip"];
    const { categories } = await build({
      products,
      inventory: variants.map((v) => orderableInv(v.id, 150)),
      optionGroups: [{ id: "og_dip", name: "Dip", values: [{ id: "cheese", name: "Cheese", priceDelta: 0 }] }],
    });
    const entry = allEntries(categories)[0];
    expect(entry.optionGroups?.map((g) => g.id)).toEqual(["og_dip"]);
    expect(entry.variants?.every((v) => v.optionGroups === undefined)).toBe(true);
  });

  it("picks up a group this store attached on its own inventory row", async () => {
    const p = product("p1", { optionGroupIds: [] });
    const { categories } = await build({
      products: [p],
      inventory: [orderableInv("p1", 250, { optionGroupIds: ["og_local"] })],
      optionGroups: [{ id: "og_local", name: "Local Dip", values: [{ id: "v1", name: "Sukang Pinakurat", priceDelta: 10 }] }],
    });
    expect(allEntries(categories)[0].optionGroups?.map((g) => g.id)).toEqual(["og_local"]);
  });

  it("picks up a group THIS STORE attached to a single variant, without leaking to its siblings", async () => {
    const { products, variants } = kimbap(["Veggies", "Signature"]);
    products[0].optionGroupIds = ["og_dip"]; // family-wide
    const { categories } = await build({
      products,
      inventory: [
        orderableInv(variants[0].id, 150),
        // Only Signature's row at THIS store carries the extra group.
        orderableInv(variants[1].id, 150, { optionGroupIds: ["og_local"] }),
      ],
      optionGroups: [
        { id: "og_dip", name: "Dip", values: [{ id: "cheese", name: "Cheese", priceDelta: 0 }] },
        { id: "og_local", name: "Branch Special", values: [{ id: "v1", name: "Extra Sauce", priceDelta: 15 }] },
      ],
    });
    const entry = allEntries(categories)[0];

    expect(entry.optionGroups?.map((g) => g.id)).toEqual(["og_dip"]);
    expect(entry.variants?.[0].optionGroups).toBeUndefined();          // Veggies untouched
    expect(entry.variants?.[1].optionGroups?.map((g) => g.id)).toEqual(["og_dip", "og_local"]);
  });

  it("lets a store's own attachment be withheld again by its option overrides", async () => {
    const p = product("p1", { optionGroupIds: [] });
    const { categories } = await build({
      products: [p],
      inventory: [orderableInv("p1", 250, { optionGroupIds: ["og_local"] })],
      optionGroups: [{ id: "og_local", name: "Branch Special", values: [{ id: "v1", name: "Extra Sauce", priceDelta: 15 }] }],
      // Attach and disable must layer, not fight — disable wins.
      optionOverrides: { disabledGroupIds: ["og_local"], disabledValueKeys: [] },
    });
    expect(allEntries(categories)[0].optionGroups).toBeUndefined();
  });

  it("attaches this store's option groups, dropping ones it has disabled", async () => {
    const p = product("p1", { optionGroupIds: ["og_dip", "og_size"] });
    const optionGroups = [
      { id: "og_dip", name: "Dip", values: [{ id: "cheese", name: "Cheese", priceDelta: 20 }] },
      { id: "og_size", name: "Size", values: [{ id: "large", name: "Large", priceDelta: 50 }] },
    ];
    const { categories } = await build({
      products: [p],
      inventory: [orderableInv("p1", 250)],
      optionGroups,
      optionOverrides: { disabledGroupIds: ["og_dip"], disabledValueKeys: [] },
    });
    expect(allEntries(categories)[0].optionGroups?.map((g) => g.id)).toEqual(["og_size"]);
  });
});

describe("rebuildCustomerCatalog — legacy flat items", () => {
  it("still writes the flat items[] array the deployed CUSTOMER app reads", async () => {
    const p = product("p1", { name: "Samgyupsal" });
    const { items, itemCount } = await build({ products: [p], inventory: [inv("p1", 250)] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "p1", name: "Samgyupsal", price: 250, isAvailable: true });
    expect(itemCount).toBe(1);
  });

  it("disambiguates variant names in the flat array so three Kimbaps stop looking identical", async () => {
    const { products, variants } = kimbap(["Veggies", "Signature", "Spicy"]);
    const { items } = await build({ products, inventory: variants.map((v) => inv(v.id, 150)) });
    expect(items.map((i) => i.name).sort()).toEqual([
      "Kimbap (Signature)",
      "Kimbap (Spicy)",
      "Kimbap (Veggies)",
    ]);
  });

  it("falls back to the product's name/category/image when the inventory row lacks them", async () => {
    const p = product("p1", { name: "Kimchi Jjigae", subCategory: "Stews", imageUrl: "https://example.com/kimchi.jpg" });
    const { items } = await build({ products: [p], inventory: [inv("p1", 250, { name: undefined, imageUrl: undefined })] });
    expect(items[0]).toMatchObject({ name: "Kimchi Jjigae", category: "Stews", imageUrl: "https://example.com/kimchi.jpg" });
  });
});
