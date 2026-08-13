import { describe, it, expect } from "vitest";
import { rebuildCustomerCatalog, type CustomerCatalogItem } from "@/lib/server/customer-catalog";

/**
 * Minimal in-memory stand-in for the Admin SDK surface the builder touches.
 * Nothing reaches Firestore: the final `.set()` is captured, not sent.
 */
function fakeDb(opts: { products: any[]; inventory: any[] }) {
  const written: { path: string; data: any }[] = [];
  const coll = (docs: any[]) => ({ get: async () => ({ docs: docs.map((d) => ({ id: d.id, data: () => d })) }) });
  const db: any = {
    collection(path: string) {
      if (path === "products") return coll(opts.products);
      if (/\/inventory$/.test(path)) return coll(opts.inventory);
      return coll([]);
    },
    doc(path: string) {
      return {
        // Always a cold cache (getStoreInventoryRows' inventoryCache doc) —
        // every test exercises a fresh scan, matching pre-cache behaviour.
        get: async () => ({ exists: false, data: () => undefined, get: () => undefined }),
        set: async (data: any) => { written.push({ path, data }); },
      };
    },
  };
  return { db, written };
}

const STORE = "STORE_X";

/** A store inventory row. `customerEnabled: true` is the baseline — availability is opt-in. */
const inv = (productId: string, sellingPrice: number, over: Record<string, any> = {}) => ({
  id: `i_${productId}`,
  productId,
  sellingPrice,
  isActive: true,
  isArchived: false,
  customerEnabled: true,
  ...over,
});

const product = (id: string, over: Record<string, any> = {}) => ({
  id,
  name: `Product ${id}`,
  subCategory: "Uncategorized",
  isActive: true,
  isArchived: false,
  ...over,
});

async function build(opts: Parameters<typeof fakeDb>[0]): Promise<{ items: CustomerCatalogItem[]; itemCount: number }> {
  const { db, written } = fakeDb(opts);
  await rebuildCustomerCatalog(db, STORE);
  // Also writes stores/{STORE}/inventoryCache/main (the shared inventory-scan
  // cache from getStoreInventoryRows) — filter to the doc this suite tests.
  const catalogWrite = written.find((w) => w.path === `stores/${STORE}/catalogCache/main`);
  expect(catalogWrite).toBeDefined();
  return catalogWrite!.data;
}

describe("rebuildCustomerCatalog", () => {
  it("publishes an inventory row with customerEnabled true", async () => {
    const p = product("p1", { name: "Samgyupsal" });
    const { items } = await build({ products: [p], inventory: [inv("p1", 250)] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "p1", name: "Samgyupsal", price: 250, isAvailable: true });
  });

  it("omits a row missing customerEnabled (opt-in, not opt-out)", async () => {
    const p = product("p1");
    const { items } = await build({ products: [p], inventory: [inv("p1", 250, { customerEnabled: undefined })] });
    expect(items).toHaveLength(0);
  });

  it("omits a row with customerEnabled explicitly false", async () => {
    const p = product("p1");
    const { items } = await build({ products: [p], inventory: [inv("p1", 250, { customerEnabled: false })] });
    expect(items).toHaveLength(0);
  });

  it("always charges the store's sellingPrice — there is no separate customer price", async () => {
    const p = product("p1");
    const { items } = await build({ products: [p], inventory: [inv("p1", 300)] });
    expect(items[0].price).toBe(300);
  });

  it("withholds the item when sellingPrice is 0 rather than showing it for free", async () => {
    const p = product("p1");
    const { items } = await build({ products: [p], inventory: [inv("p1", 0)] });
    expect(items).toHaveLength(0);
  });

  it("withholds the item when sellingPrice is negative", async () => {
    const p = product("p1");
    const { items } = await build({ products: [p], inventory: [inv("p1", -5)] });
    expect(items).toHaveLength(0);
  });

  it("omits inactive or archived inventory rows even when customerEnabled", async () => {
    const p = product("p1");
    const { items: inactive } = await build({ products: [p], inventory: [inv("p1", 250, { isActive: false })] });
    expect(inactive).toHaveLength(0);
    const { items: archived } = await build({ products: [p], inventory: [inv("p1", 250, { isArchived: true })] });
    expect(archived).toHaveLength(0);
  });

  it("treats each variant as its own flat item, not a family", async () => {
    const root = product("grp", { kind: "group", name: "Sharing Set" });
    const v1 = product("v1", { kind: "variant", groupId: "grp", name: "Sharing Set", subCategory: "Sets" });
    const v2 = product("v2", { kind: "variant", groupId: "grp", name: "Sharing Set", subCategory: "Sets" });
    const { items } = await build({
      products: [root, v1, v2],
      inventory: [inv("v1", 500), inv("v2", 900)],
    });
    expect(items.map((i) => i.id).sort()).toEqual(["v1", "v2"]);
  });

  it("falls back to the product's name/category/image when the inventory row lacks them", async () => {
    const p = product("p1", { name: "Kimchi Jjigae", subCategory: "Stews", imageUrl: "https://example.com/kimchi.jpg" });
    const { items } = await build({ products: [p], inventory: [inv("p1", 250, { name: undefined, imageUrl: undefined })] });
    expect(items[0]).toMatchObject({ name: "Kimchi Jjigae", category: "Stews", imageUrl: "https://example.com/kimchi.jpg" });
  });
});
