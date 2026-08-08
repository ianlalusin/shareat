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
const inv = (productId: string, sellingPrice: number, over: Record<string, any> = {}) => ({ id: `i_${productId}`, productId, sellingPrice, isActive: true, isArchived: false, ...over });

/** A group root plus variants, with whatever description fields the test needs. */
function family(over: { root?: any; variants?: any[] } = {}) {
  const root = { id: "grp", name: "Sharing Set", kind: "group", showOnStorefront: true, isActive: true, subCategory: "Sets", ...over.root };
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
      products: [{ id: "s1", name: "Samgyup In A Box", kind: "single", showOnStorefront: true, isActive: true, subCategory: "Cooked", description: "Grilled pork samgyupsal rice box, ready to go." }],
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
      products: [{ id: "s1", name: "Big", kind: "single", showOnStorefront: true, isActive: true, subCategory: "X", description: long }],
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
      products: [{ id: "s1", name: "Exact", kind: "single", showOnStorefront: true, isActive: true, subCategory: "X", description: exact }],
      inventory: [inv("s1", 100)],
    });
    expect(onlyItem(cat).description).toBe(exact);
  });
});

describe("untouched behaviour", () => {
  it("still drops variants with no price and skips a family with none priced", async () => {
    const cat = await build({
      products: [
        { id: "grp", name: "Half", kind: "group", showOnStorefront: true, isActive: true, subCategory: "X", description: "d" },
        { id: "v1", name: "Half", kind: "variant", groupId: "grp", variantLabel: "Priced", isActive: true, description: "has copy" },
        { id: "v2", name: "Half", kind: "variant", groupId: "grp", variantLabel: "Unpriced", isActive: true, description: "has copy too" },
        { id: "grp2", name: "None", kind: "group", showOnStorefront: true, isActive: true, subCategory: "X" },
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

  it("still honours the showOnStorefront gate", async () => {
    const cat = await build({
      products: [{ id: "s1", name: "Hidden", kind: "single", showOnStorefront: false, isActive: true, subCategory: "X", description: "d" }],
      inventory: [inv("s1", 100)],
    });
    expect(cat.itemCount).toBe(0);
  });
});

/** One storefront-flagged single SKU whose inventory row the test controls. */
const oneSingle = (invOver: Record<string, any> = {}, sellingPrice = 249) => ({
  products: [{ id: "s1", name: "Unli Pork", kind: "single", showOnStorefront: true, isActive: true, subCategory: "Unli" }],
  inventory: [inv("s1", sellingPrice, invOver)],
});

describe("per-branch online availability (onlineEnabled)", () => {
  /**
   * The backwards-compatibility guarantee, and the reason the builder tests
   * `=== false` rather than `!== true`. No live inventory row carries this
   * field yet; if a missing value read as "withheld", every published item at
   * every branch would vanish the first time this ships.
   */
  it("publishes an item whose inventory has NO onlineEnabled field at all", async () => {
    const opts = oneSingle();
    expect(opts.inventory[0]).not.toHaveProperty("onlineEnabled");
    const cat = await build(opts);
    expect(cat.itemCount).toBe(1);
    expect(onlyItem(cat).price).toBe(249);
  });

  it("publishes an item the branch has explicitly enabled online", async () => {
    const cat = await build(oneSingle({ onlineEnabled: true }));
    expect(cat.itemCount).toBe(1);
  });

  it("drops an item the branch has withheld, despite the global flag and a good price", async () => {
    const cat = await build(oneSingle({ onlineEnabled: false }));
    expect(cat.itemCount).toBe(0);
    expect(cat.categories).toHaveLength(0);
  });
});

describe("per-branch online price (onlinePrice)", () => {
  it("charges the online price when one is set, not the dine-in price", async () => {
    const cat = await build(oneSingle({ onlinePrice: 299 }, 249));
    expect(onlyItem(cat).price).toBe(299);
  });

  // Anything that is not a positive finite number means "no online price set"
  // and must fall back to sellingPrice — never to 0, which downstream reads as
  // "not sellable" and would silently drop the item.
  const fallbacks: [string, Record<string, any>][] = [
    ["missing", {}],
    ["null", { onlinePrice: null }],
    ["zero", { onlinePrice: 0 }],
    ["negative", { onlinePrice: -50 }],
  ];
  for (const [label, over] of fallbacks) {
    it(`falls back to sellingPrice when onlinePrice is ${label}`, async () => {
      const cat = await build(oneSingle(over, 249));
      expect(cat.itemCount).toBe(1);
      expect(onlyItem(cat).price).toBe(249);
    });
  }
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

  it("keeps the surviving variants when the branch withholds only one", async () => {
    const f = family();
    f.inventory = [inv("v1", 1111, { onlineEnabled: false }), inv("v2", 2222)];

    const item = onlyItem(await build(f));
    expect(item.variants!.map((v) => v.productId)).toEqual(["v2"]);
    expect(item.price).toBe(2222);
  });
});
