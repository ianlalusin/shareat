import { describe, it, expect, vi } from "vitest";
import { rebuildStorefrontCatalog, type StorefrontCatalog } from "@/lib/server/storefront-catalog";

/**
 * Minimal in-memory stand-in for the Admin SDK surface the builder touches.
 * Nothing reaches Firestore: the final `.set()` is captured, not sent.
 */
function fakeDb(opts: {
  products: any[];
  inventory: any[];
  optionGroups?: any[];
  optionOverrides?: any | null;
}) {
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
        get: async () => ({
          exists: /optionOverrides/.test(path) && !!opts.optionOverrides,
          data: () => opts.optionOverrides,
        }),
        set: async (data: any) => { written.push({ path, data }); },
      };
    },
  };
  return { db, written };
}

const STORE = "STORE_X";
/**
 * A store inventory row.
 *
 * `onlineEnabled: true` is part of the baseline because online availability is
 * opt-in: a row without it publishes nothing at all. Every fixture below that
 * is really testing something else (descriptions, the length cap, pricing) has
 * to opt in explicitly in order to have anything to assert on.
 */
const inv = (productId: string, sellingPrice: number, over: Record<string, any> = {}) => ({ id: `i_${productId}`, productId, sellingPrice, isActive: true, isArchived: false, onlineEnabled: true, ...over });

/** A group root plus variants, with whatever description fields the test needs. */
function family(over: { root?: any; variants?: any[] } = {}) {
  const root = { id: "grp", name: "Sharing Set", kind: "group", isActive: true, subCategory: "Sets", ...over.root };
  const variants = over.variants ?? [
    { id: "v1", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Set 1", isActive: true },
    { id: "v2", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Set 2", isActive: true },
  ];
  return { products: [root, ...variants], inventory: variants.map((v, i) => inv(v.id, 1111 * (i + 1))) };
}

async function build(opts: Parameters<typeof fakeDb>[0]): Promise<StorefrontCatalog> {
  const { db, written } = fakeDb(opts);
  await rebuildStorefrontCatalog(db, STORE);
  expect(written).toHaveLength(1);
  expect(written[0].path).toBe(`stores/${STORE}/storefrontCatalog/main`);
  return written[0].data as StorefrontCatalog;
}

const onlyItem = (cat: StorefrontCatalog) => cat.categories[0].items[0];

describe("per-variant descriptions", () => {
  it("gives a variant its own description when it has one", async () => {
    const f = family({
      root: { description: "Root blurb." },
      variants: [
        { id: "v1", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Set 1", isActive: true, description: "Set One: no chicken, no Coke." },
        { id: "v2", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Set 2", isActive: true, description: "Set Two: with chicken." },
      ],
    });
    const item = onlyItem(await build(f));
    expect(item.description).toBe("Root blurb.");
    expect(item.variants!.find((v) => v.variantLabel === "Set 1")!.description).toBe("Set One: no chicken, no Coke.");
    expect(item.variants!.find((v) => v.variantLabel === "Set 2")!.description).toBe("Set Two: with chicken.");
  });

  it("a variant with no description of its own inherits the root's", async () => {
    const f = family({
      root: { description: "Root blurb." },
      variants: [
        { id: "v1", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Set 1", isActive: true, description: "Set One only." },
        { id: "v2", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Set 2", isActive: true }, // none
      ],
    });
    const item = onlyItem(await build(f));
    expect(item.variants!.find((v) => v.variantLabel === "Set 1")!.description).toBe("Set One only.");
    expect(item.variants!.find((v) => v.variantLabel === "Set 2")!.description).toBe("Root blurb.");
  });

  it("inherits nothing when the root has no description either", async () => {
    const f = family({
      root: {},
      variants: [
        { id: "v1", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Set 1", isActive: true, description: "Only this one." },
        { id: "v2", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Set 2", isActive: true },
      ],
    });
    const item = onlyItem(await build(f));
    expect(item.description).toBeUndefined();
    expect(item.variants!.find((v) => v.variantLabel === "Set 1")!.description).toBe("Only this one.");
    expect(item.variants!.find((v) => v.variantLabel === "Set 2")).not.toHaveProperty("description");
  });
});

describe("REGRESSION: families that do not use per-variant copy are unchanged", () => {
  it("serialises byte-identically to the pre-change shape", async () => {
    // Mirrors the live Kimbap family: root blurb, variants with none.
    const f = family({
      root: { id: "grp", name: "Kimbap", description: "Crispy seaweed rice rolls packed with veggies and savory fillings." },
      variants: [
        { id: "v1", name: "Kimbap", kind: "variant", groupId: "grp", variantLabel: "Veggies", isActive: true },
        { id: "v2", name: "Kimbap", kind: "variant", groupId: "grp", variantLabel: "Signature", isActive: true },
      ],
    });
    const item = onlyItem(await build(f));

    // The exact shape this file produced before per-variant descriptions existed.
    expect(JSON.parse(JSON.stringify(item.variants))).toEqual([
      { productId: "v1", variantLabel: "Veggies", displayName: "Kimbap (Veggies)", price: 1111, imageUrl: null },
      { productId: "v2", variantLabel: "Signature", displayName: "Kimbap (Signature)", price: 2222, imageUrl: null },
    ]);
    for (const v of item.variants!) expect(Object.keys(v)).not.toContain("description");
    expect(item.description).toBe("Crispy seaweed rice rolls packed with veggies and savory fillings.");
  });

  it("a single (non-group) product is unaffected", async () => {
    const cat = await build({
      products: [{ id: "s1", name: "Samgyup In A Box", kind: "single", isActive: true, subCategory: "Cooked", description: "Grilled pork samgyupsal rice box, ready to go." }],
      inventory: [inv("s1", 239)],
    });
    const item = onlyItem(cat);
    expect(JSON.parse(JSON.stringify(item))).toEqual({
      productId: "s1", name: "Samgyup In A Box", displayName: "Samgyup In A Box",
      subCategory: "Cooked", imageUrl: null, kind: "single", price: 239,
      description: "Grilled pork samgyupsal rice box, ready to go.",
    });
  });
});

describe("the 1000-character cap", () => {
  const HOOK = "Buong barkada sa isang set — meats, sides, ramen at cheese. Ihanda niyo sa bahay, sarap ng samgyup kahit saan.";
  const REAL_412 =
    `${HOOK} Kasama: 1500g Pork Plain, 800g Pork Flavored, 300g pork with enoki, 1000g Beef Plain, 800g Beef Flavored, 300g beef with enoki, 1000g chicken, 500g chicken flavored, 1500g Lettuce, 250g fishcake, 250g tteokbokki, 1000g kimchi, 6 more side dishes, 3 Jin Ramen, 3 coke 1.5 L, Cheese. Ideal for 20-25pax.`;

  it("a real 412-char tier description survives completely intact", async () => {
    expect(REAL_412.length).toBeGreaterThan(400);
    expect(REAL_412.length).toBeLessThan(500);
    const f = family({
      root: { description: "Root." },
      variants: [
        { id: "v1", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Set 5", isActive: true, description: REAL_412 },
        { id: "v2", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Set 4", isActive: true, description: "Shorter." },
      ],
    });
    const item = onlyItem(await build(f));
    const v = item.variants!.find((x) => x.variantLabel === "Set 5")!;
    expect(v.description).toBe(REAL_412);
    expect(v.description!.length).toBe(REAL_412.length);
    // The old 280 cap would have destroyed it.
    expect(v.description!.length).toBeGreaterThan(280);
  });

  it("truncates an over-long description at a word boundary, never mid-word", async () => {
    const long = ("alpha bravo charlie delta echo foxtrot golf hotel india juliet ".repeat(40)).trim();
    expect(long.length).toBeGreaterThan(1200);
    const f = family({
      root: { description: "Root." },
      variants: [
        { id: "v1", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Long", isActive: true, description: long },
        { id: "v2", name: "Sharing Set", kind: "variant", groupId: "grp", variantLabel: "Short", isActive: true, description: "Fine." },
      ],
    });
    const item = onlyItem(await build(f));
    const d = item.variants!.find((x) => x.variantLabel === "Long")!.description!;
    expect(d.length).toBeLessThanOrEqual(1000);
    expect(d.length).toBeGreaterThan(900); // cut near the cap, not far short of it
    expect(d.endsWith(" ")).toBe(false);
    // Every emitted token must be a whole word from the source.
    const words = new Set(long.split(" "));
    for (const w of d.split(" ")) expect(words.has(w)).toBe(true);
    // And the source continues past the cut, so something really was removed.
    expect(long.startsWith(d)).toBe(true);
    expect(long.length).toBeGreaterThan(d.length);
  });

  it("applies the same cap and word-boundary rule to the root description", async () => {
    const long = ("kimchi tteokbokki fishcake lettuce samgyupsal ".repeat(40)).trim();
    const cat = await build({
      products: [{ id: "s1", name: "Big", kind: "single", isActive: true, subCategory: "X", description: long }],
      inventory: [inv("s1", 100)],
    });
    const d = onlyItem(cat).description!;
    expect(d.length).toBeLessThanOrEqual(1000);
    const words = new Set(long.split(" "));
    for (const w of d.split(" ")) expect(words.has(w)).toBe(true);
  });

  it("a 1000-char description is kept exactly, not trimmed by an off-by-one", async () => {
    const exact = "a".repeat(999) + "b";
    expect(exact.length).toBe(1000);
    const cat = await build({
      products: [{ id: "s1", name: "Exact", kind: "single", isActive: true, subCategory: "X", description: exact }],
      inventory: [inv("s1", 100)],
    });
    expect(onlyItem(cat).description).toBe(exact);
  });
});

describe("untouched behaviour", () => {
  it("still drops variants with no price and skips a family with none priced", async () => {
    const cat = await build({
      products: [
        { id: "grp", name: "Half", kind: "group", isActive: true, subCategory: "X", description: "d" },
        { id: "v1", name: "Half", kind: "variant", groupId: "grp", variantLabel: "Priced", isActive: true, description: "has copy" },
        { id: "v2", name: "Half", kind: "variant", groupId: "grp", variantLabel: "Unpriced", isActive: true, description: "has copy too" },
        { id: "grp2", name: "None", kind: "group", isActive: true, subCategory: "X" },
        { id: "v3", name: "None", kind: "variant", groupId: "grp2", variantLabel: "Zero", isActive: true },
      ],
      inventory: [inv("v1", 500), inv("v3", 0)],
    });
    expect(cat.itemCount).toBe(1);
    const item = onlyItem(cat);
    expect(item.variants).toHaveLength(1);
    expect(item.variants![0].variantLabel).toBe("Priced");
    expect(item.price).toBe(500);
  });

});

/** One storefront-flagged single SKU whose inventory row the test controls. */
const oneSingle = (invOver: Record<string, any> = {}, sellingPrice = 249) => ({
  products: [{ id: "s1", name: "Unli Pork", kind: "single", isActive: true, subCategory: "Unli" }],
  inventory: [inv("s1", sellingPrice, invOver)],
});

describe("per-branch online availability (onlineEnabled) is the ONLY gate", () => {
  /**
   * Online availability is opt-in, per branch. `onlineEnabled` is the single
   * gate — the old global products/{id}.showOnStorefront flag is gone — and
   * only an explicit `true` publishes.
   *
   * This is the inverse of the two-gate design that preceded it: back then a
   * missing field had to mean "offered" so that removing nothing broke
   * nothing. With the global gate deleted, a missing field meaning "offered"
   * would instead put a store's entire priced inventory on the public menu,
   * so the default flipped and existing rows are opted in by a backfill.
   */
  it("does NOT publish an item whose inventory has no onlineEnabled field", async () => {
    const cat = await build({
      products: [{ id: "s1", name: "Unli Pork", kind: "single", isActive: true, subCategory: "Unli" }],
      inventory: [{ id: "i_s1", productId: "s1", sellingPrice: 249, isActive: true, isArchived: false }],
    });
    expect(cat.itemCount).toBe(0);
  });

  it("publishes an item the branch has explicitly enabled online", async () => {
    const cat = await build(oneSingle({ onlineEnabled: true }));
    expect(cat.itemCount).toBe(1);
    expect(onlyItem(cat).price).toBe(249);
  });

  it("drops an item the branch has withheld, despite a good price", async () => {
    const cat = await build(oneSingle({ onlineEnabled: false }));
    expect(cat.itemCount).toBe(0);
    expect(cat.categories).toHaveLength(0);
  });

  /**
   * The retired global flag must be inert in both directions — a leftover
   * `false` on a product may not veto a branch that has opted the item in,
   * and a leftover `true` may not publish one that has not.
   */
  it("ignores the retired global showOnStorefront flag entirely", async () => {
    const offButEnabled = await build({
      products: [{ id: "s1", name: "Unli Pork", kind: "single", showOnStorefront: false, isActive: true, subCategory: "Unli" }],
      inventory: [inv("s1", 249)],
    });
    expect(offButEnabled.itemCount).toBe(1);

    const onButNotEnabled = await build({
      products: [{ id: "s1", name: "Unli Pork", kind: "single", isActive: true, subCategory: "Unli" }],
      inventory: [inv("s1", 249, { onlineEnabled: false })],
    });
    expect(onButNotEnabled.itemCount).toBe(0);
  });

  it("still skips inactive and archived inventory even when opted in", async () => {
    const inactive = await build(oneSingle({ isActive: false }));
    expect(inactive.itemCount).toBe(0);

    const archived = await build(oneSingle({ isArchived: true }));
    expect(archived.itemCount).toBe(0);
  });
});

/**
 * `inventory.imageUrl` is a per-store LOCAL OVERRIDE of the global
 * `products/{id}.imageUrl`, never a copy of it — so every image the snapshot
 * carries must resolve local-first. Before this suite, two of the three sites
 * preferred the global photo, which meant a manager's own upload never reached
 * the public menu for any product that already had a catalog picture.
 */
describe("item photos: the store's local override wins over the global product photo", () => {
  const LOCAL = "https://firebasestorage.googleapis.com/v0/b/x/o/productPhotos%2Fs1%2FSTORE_X%2Fuuid.webp";
  const GLOBAL = "https://firebasestorage.googleapis.com/v0/b/x/o/Items%2Fs1.webp";

  it("a single SKU shows the store's photo, not the global one", async () => {
    const cat = await build({
      products: [{ id: "s1", name: "Unli Pork", kind: "single", isActive: true, subCategory: "Unli", imageUrl: GLOBAL }],
      inventory: [inv("s1", 249, { imageUrl: LOCAL })],
    });
    expect(onlyItem(cat).imageUrl).toBe(LOCAL);
  });

  it("a single SKU with no local photo inherits the global one", async () => {
    const cat = await build({
      products: [{ id: "s1", name: "Unli Pork", kind: "single", isActive: true, subCategory: "Unli", imageUrl: GLOBAL }],
      inventory: [inv("s1", 249)], // no imageUrl at all — the normal state
    });
    expect(onlyItem(cat).imageUrl).toBe(GLOBAL);
  });

  it("a variant shows its store photo over both its own and the family's global photo", async () => {
    const f = family({
      root: { imageUrl: "https://firebasestorage.googleapis.com/v0/b/x/o/Items%2Fgrp.webp" },
      variants: [
        { id: "v1", name: "Kimbap", kind: "variant", groupId: "grp", variantLabel: "Veggies", isActive: true, imageUrl: GLOBAL },
        { id: "v2", name: "Kimbap", kind: "variant", groupId: "grp", variantLabel: "Signature", isActive: true, imageUrl: GLOBAL },
      ],
    });
    f.inventory = [inv("v1", 1111, { imageUrl: LOCAL }), inv("v2", 2222)];

    const item = onlyItem(await build(f));
    expect(item.variants!.find((v) => v.productId === "v1")!.imageUrl).toBe(LOCAL);
    // The sibling with no local photo still inherits its own global one.
    expect(item.variants!.find((v) => v.productId === "v2")!.imageUrl).toBe(GLOBAL);
  });

  it("a variant with neither a local nor its own global photo falls back to the family root's", async () => {
    const ROOT = "https://firebasestorage.googleapis.com/v0/b/x/o/Items%2Fgrp.webp";
    const f = family({ root: { imageUrl: ROOT } });
    const item = onlyItem(await build(f));
    for (const v of item.variants!) expect(v.imageUrl).toBe(ROOT);
  });

  it("the family tile itself carries the root's global photo (a store carries no row for the group)", async () => {
    const ROOT = "https://firebasestorage.googleapis.com/v0/b/x/o/Items%2Fgrp.webp";
    const f = family({ root: { imageUrl: ROOT } });
    expect(onlyItem(await build(f)).imageUrl).toBe(ROOT);
  });
});

describe("per-branch online price (onlinePrice)", () => {
  it("charges the online price when one is set, not the dine-in price", async () => {
    const cat = await build(oneSingle({ onlinePrice: 299 }, 249));
    expect(onlyItem(cat).price).toBe(299);
  });

  // An UNSET online price means "charge the same as the table" — this is what
  // the edit dialog's "leave blank to match" writes, and it must keep working.
  const unset: [string, Record<string, any>][] = [
    ["missing", {}],
    ["null", { onlinePrice: null }],
  ];
  for (const [label, over] of unset) {
    it(`falls back to sellingPrice when onlinePrice is ${label}`, async () => {
      const cat = await build(oneSingle(over, 249));
      expect(cat.itemCount).toBe(1);
      expect(onlyItem(cat).price).toBe(249);
    });
  }

  /**
   * A SET but non-positive online price is an explicit "not sellable online",
   * and must NOT fall back to the dine-in price.
   *
   * An item a manager has switched online but priced at 0 is one they have not
   * finished pricing. Publishing it at the table price would charge a customer
   * a number nobody chose; publishing it at 0 would give it away. It is
   * withheld until the price is real.
   */
  const withheld: [string, Record<string, any>][] = [
    ["zero", { onlinePrice: 0 }],
    ["negative", { onlinePrice: -50 }],
  ];
  for (const [label, over] of withheld) {
    it(`withholds the item when onlinePrice is ${label}, despite a good store price`, async () => {
      const cat = await build(oneSingle(over, 249));
      expect(cat.itemCount).toBe(0);
    });
  }

  it("withholds a zero-priced item even though the branch toggled it online", async () => {
    const cat = await build(oneSingle({ onlineEnabled: true, onlinePrice: 0 }, 500));
    expect(cat.itemCount).toBe(0);
    expect(cat.categories).toHaveLength(0);
  });
});

describe("online overrides on variant families", () => {
  it("reprices one variant only, and recomputes the family's 'from' price and order", async () => {
    // v1 is the cheaper tier dine-in (1111 vs 2222) and so is normally the
    // family's "from" price. Pricing v1 at 3000 online must hand that role to
    // v2 — proving the "from" price is derived from the resolved online set,
    // not from sellingPrice.
    const f = family();
    f.inventory = [inv("v1", 1111, { onlinePrice: 3000 }), inv("v2", 2222)];

    const item = onlyItem(await build(f));
    const v1 = item.variants!.find((v) => v.productId === "v1")!;
    const v2 = item.variants!.find((v) => v.productId === "v2")!;

    expect(v1.price).toBe(3000);          // overridden
    expect(v2.price).toBe(2222);          // sibling untouched
    expect(item.price).toBe(2222);        // "from" recomputed, no longer 1111
    expect(item.variants!.map((v) => v.price)).toEqual([2222, 3000]); // still sorted ascending
  });

  it("drops a family entirely when the branch withholds every variant", async () => {
    const f = family();
    f.inventory = [inv("v1", 1111, { onlineEnabled: false }), inv("v2", 2222, { onlineEnabled: false })];

    const cat = await build(f);
    expect(cat.itemCount).toBe(0);
    expect(cat.categories).toHaveLength(0); // dropped, not published as an empty family
  });

  it("drops only the variant priced 0 online, and recomputes the family's 'from'", async () => {
    // v1 is the cheaper tier, so dropping it must move the family's "from"
    // price up to v2 rather than leaving a stale 1111 behind.
    const f = family();
    f.inventory = [inv("v1", 1111, { onlinePrice: 0 }), inv("v2", 2222)];

    const item = onlyItem(await build(f));
    expect(item.variants!.map((v) => v.productId)).toEqual(["v2"]);
    expect(item.price).toBe(2222);
  });

  it("drops the whole family when every variant is priced 0 online", async () => {
    const f = family();
    f.inventory = [inv("v1", 1111, { onlinePrice: 0 }), inv("v2", 2222, { onlinePrice: 0 })];

    const cat = await build(f);
    expect(cat.itemCount).toBe(0);
    expect(cat.categories).toHaveLength(0);
  });

  it("keeps the surviving variants when the branch withholds only one", async () => {
    const f = family();
    f.inventory = [inv("v1", 1111, { onlineEnabled: false }), inv("v2", 2222)];

    const item = onlyItem(await build(f));
    expect(item.variants!.map((v) => v.productId)).toEqual(["v2"]);
    expect(item.price).toBe(2222);
  });
});
