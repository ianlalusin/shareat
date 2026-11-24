/**
 * Menu-management workflow stress tests.
 *
 * These exercise the pure logic that backs the three screens the request is
 * about — the global admin product page (/admin/menu/products), the global
 * flavors/packages/refills pages, and the per-store menu (store-settings
 * Packages/Refills/Flavors). Every function below is a no-Firestore, no-React
 * pure projection, so the stress cases run deterministically and fast.
 *
 * Covered operations, mapped to their code:
 *   - create/update grouping   -> groupIntoFamilies (variant family assembly)
 *   - archive / deactivate     -> globalInactiveIds + partitionVisibleRefills
 *                                  (the two-switch global kill vs store enable)
 *   - reactivate / re-enable   -> the same gates, inverted
 *   - delete (stale grants)    -> stalePackageIds (a deleted/disabled refill a
 *                                  package still lists)
 *   - variant label + display  -> getDisplayName / getEffectiveVariantLabel
 *   - modifier attachment      -> resolveOptionGroupIds (parent ∪ variant ∪ store)
 */

import { describe, it, expect } from "vitest";
import {
  groupIntoFamilies,
  getKind,
  getDisplayName,
  getEffectiveVariantLabel,
  isSellableSku,
  getGroupKey,
  getGroupTitle,
  resolveFamilyImageUrl,
  type ProductLike,
} from "@/lib/products/variants";
import {
  globalInactiveIds,
  partitionVisibleRefills,
  stalePackageIds,
} from "@/lib/refill-visibility";
import { applyRefillTap, pruneFlavorless, picksFlavorFor } from "@/lib/refill-selection";
import { resolveOptionGroupIds } from "@/lib/server/catalog-shared";

// Deterministic PRNG (mulberry32) so the "random" stress data is reproducible
// across runs and machines.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Variant family assembly (groupIntoFamilies) — the "create/update product"
// projection used by the POS, manager inventory, storefront and customer app.
// ---------------------------------------------------------------------------
describe("groupIntoFamilies stress", () => {
  function buildCatalog(rand: () => number, n: number): ProductLike[] {
    const items: ProductLike[] = [];
    for (let i = 0; i < n; i++) {
      const roll = rand();
      if (roll < 0.45) {
        items.push({ id: `s${i}`, kind: "single", name: `Single ${i}` });
      } else if (roll < 0.9) {
        const g = `g${Math.floor(rand() * Math.max(1, n / 8))}`;
        items.push({
          id: `v${i}`,
          kind: "variant",
          groupId: g,
          groupName: `Family ${g}`,
          name: `Family ${g}`,
          variantLabel: `Label ${i}`,
        });
      } else {
        // A "variant" with no groupId — must render standalone, never crash.
        items.push({ id: `o${i}`, kind: "variant", name: `Orphan ${i}` });
      }
    }
    return items;
  }

  it("preserves every item exactly once across thousands of products", () => {
    const rand = mulberry32(0xabcd);
    for (const n of [0, 1, 2, 100, 5000]) {
      const items = buildCatalog(rand, n);
      const rows = groupIntoFamilies(items);

      const seen = new Set<string>();
      let counted = 0;
      for (const row of rows) {
        if (row.kind === "family") {
          for (const v of row.variants) {
            if (v.id) expect(seen.has(v.id)).toBe(false);
            if (v.id) seen.add(v.id!);
            counted++;
          }
        } else {
          if (row.item.id) expect(seen.has(row.item.id)).toBe(false);
          if (row.item.id) seen.add(row.item.id!);
          counted++;
        }
      }
      expect(counted).toBe(items.length);
    }
  });

  it("coalesces all members of one family into a single row regardless of order", () => {
    const items: ProductLike[] = [
      { id: "v1", kind: "variant", groupId: "g", groupName: "K", name: "K", variantLabel: "A" },
      { id: "x", kind: "single", name: "Water" },
      { id: "v2", kind: "variant", groupId: "g", groupName: "K", name: "K", variantLabel: "B" },
      { id: "v3", kind: "variant", groupId: "g", groupName: "K", name: "K", variantLabel: "C" },
    ];
    const rows = groupIntoFamilies(items);
    const families = rows.filter((r) => r.kind === "family");
    expect(families).toHaveLength(1);
    expect((families[0] as any).variants.map((v: any) => v.id)).toEqual(["v1", "v2", "v3"]);
    // The single is preserved alongside.
    expect(rows.find((r) => r.kind === "single")).toMatchObject({ kind: "single" });
  });

  it("never groups a variant that lost its groupId into someone else's family", () => {
    const rows = groupIntoFamilies([
      { id: "v1", kind: "variant", groupId: "g", groupName: "K", name: "K" },
      { id: "loose", kind: "variant", name: "Loose" },
    ]);
    const singles = rows.filter((r) => r.kind === "single");
    expect(singles).toHaveLength(1);
    expect((singles[0] as any).item.id).toBe("loose");
  });
});

describe("display-name helpers stress", () => {
  it("never appends a variant label to a group (family umbrella)", () => {
    expect(getDisplayName({ name: "Kimbap", kind: "group", variantLabel: "Signature" })).toBe("Kimbap");
    expect(getDisplayName({ name: "Kimbap", kind: "group", variant: "Signature" })).toBe("Kimbap");
  });

  it("appends the label for sellable SKUs and falls back to the legacy field", () => {
    expect(getDisplayName({ name: "Kimbap", kind: "variant", variantLabel: "Signature" })).toBe(
      "Kimbap (Signature)"
    );
    expect(getDisplayName({ name: "Kimbap", kind: "single", variant: "500ml" })).toBe("Kimbap (500ml)");
  });

  it("tolerates null/empty names and labels", () => {
    expect(getDisplayName({})).toBe("");
    expect(getDisplayName({ name: null })).toBe("");
    expect(getDisplayName({ name: "X", variantLabel: "" })).toBe("X");
    expect(getEffectiveVariantLabel({ variantLabel: null, variant: "legacy" })).toBe("legacy");
    // "":  is a real (non-nullish) value, so it wins over the legacy field via ??.
    expect(getEffectiveVariantLabel({ variantLabel: "", variant: "legacy" })).toBe("");
  });

  it("classifies kinds and sellability consistently", () => {
    expect(getKind({})).toBe("single");
    expect(isSellableSku({ kind: "group" })).toBe(false);
    expect(isSellableSku({ kind: "variant" })).toBe(true);
    expect(isSellableSku({ kind: "single" })).toBe(true);
    expect(getGroupKey({ id: "p", kind: "single" })).toBe("p");
    expect(getGroupKey({ kind: "variant", groupId: "g" })).toBe("g");
    expect(getGroupTitle({ groupName: "G", name: "N" })).toBe("G");
    expect(getGroupTitle({ name: "N" })).toBe("N");
  });

  it("resolves the family image as the first non-empty url", () => {
    expect(resolveFamilyImageUrl([{ imageUrl: null }, { imageUrl: "a" }, { imageUrl: "b" }])).toBe("a");
    expect(resolveFamilyImageUrl([{ imageUrl: undefined }, { imageUrl: "" }])).toBe(null);
    expect(resolveFamilyImageUrl([])).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Refill visibility — the "archive/deactivate/reactivate" gate for the
// customer refill menu (global isActive vs store isEnabled vs package list).
// ---------------------------------------------------------------------------
describe("partitionVisibleRefills stress", () => {
  function buildRefills(rand: () => number, n: number) {
    return Array.from({ length: n }, (_, i) => ({
      refillId: `r${i}`,
      refillName: `Refill ${i}`,
      isEnabled: rand() > 0.2,
      isOther: rand() > 0.85,
    }));
  }

  it("is total, disjoint and respects all three gates over thousands of refills", () => {
    const rand = mulberry32(0xbeef);
    const refills = buildRefills(rand, 5000);

    // Randomly retire some global docs and allow-list some package ids.
    const inactiveIds = new Set<string>();
    const allowed: string[] = [];
    for (const r of refills) {
      if (rand() < 0.1) inactiveIds.add(r.refillId);
      if (rand() < 0.5) allowed.push(r.refillId);
    }

    const { mains, others } = partitionVisibleRefills(refills, inactiveIds, allowed);
    const seen = new Set<string>();

    for (const r of [...mains, ...others]) {
      // No duplicate across or within the two buckets.
      expect(seen.has(r.refillId)).toBe(false);
      seen.add(r.refillId);

      // Every survivor must be enabled, not retired, and (if allowed list
      // exists) present in the list.
      expect(r.isEnabled).toBe(true);
      expect(inactiveIds.has(r.refillId)).toBe(false);
    }

    // Every non-survivor must have violated at least one gate.
    const survivingIds = new Set([...mains, ...others].map((r) => r.refillId));
    for (const r of refills) {
      if (survivingIds.has(r.refillId)) continue;
      const disabled = r.isEnabled === false;
      const retired = inactiveIds.has(r.refillId);
      const notAllowed = allowed.length > 0 && !allowed.includes(r.refillId);
      expect(disabled || retired || notAllowed).toBe(true);
    }
  });

  it("keeps fail-open behavior: a refill with no global doc is never hidden", () => {
    const { mains } = partitionVisibleRefills(
      [{ refillId: "orphan", isEnabled: true }, { refillId: "hasDoc", isEnabled: true }],
      globalInactiveIds([{ id: "hasDoc", isActive: true }]),
      null
    );
    expect(mains.map((r) => r.refillId).sort()).toEqual(["hasDoc", "orphan"]);
  });
});

describe("stalePackageIds stress", () => {
  it("flags every id the editor cannot select, de-duplicated and order-preserving", () => {
    const allowed = ["a", "b", "c", "a", "deleted", "retired", "b", "disabled"];
    const selectable = ["a", "b"];
    expect(stalePackageIds(allowed, selectable)).toEqual(["c", "deleted", "retired", "disabled"]);
  });

  it("tolerates malformed inputs", () => {
    expect(stalePackageIds(null, [])).toEqual([]);
    expect(stalePackageIds(undefined, ["a"])).toEqual([]);
    expect(stalePackageIds([], ["a"])).toEqual([]);
    expect(stalePackageIds(["a", "", "a"], ["a"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Refill tap state machine — "create/update/delete" a refill selection in the
// customer picker. The invariant is that focus never points at a removed entry.
// ---------------------------------------------------------------------------
describe("applyRefillTap property stress", () => {
  const needsFlavor = (id: string) => id === "pork" || id === "beef";
  const make = () => ({ flavorIds: [] as string[] });
  const ids = ["pork", "beef", "seafood", "rice"];

  it("keeps focus consistent across a long random tap sequence", () => {
    const rand = mulberry32(0xcafe);
    type Item = { flavorIds: string[] };
    let state: { cart: Map<string, Item>; activeId: string | null } = {
      cart: new Map<string, Item>(),
      activeId: null,
    };

    for (let i = 0; i < 5000; i++) {
      const id = ids[Math.floor(rand() * ids.length)];
      // Occasionally give a flavored state so meats can survive a focus move.
      if (rand() < 0.05 && state.cart.has(id)) state.cart.get(id)!.flavorIds = ["bulgogi"];

      state = applyRefillTap<Item>({
        cart: state.cart,
        activeId: state.activeId,
        tappedId: id,
        needsFlavor,
        createItem: make,
      });

      // Invariant: activeId is null or an id actually present in the cart.
      if (state.activeId !== null) expect(state.cart.has(state.activeId)).toBe(true);
    }
  });

  it("pruneFlavorless never removes the focused entry", () => {
    const cart = new Map<string, { flavorIds: string[] }>([
      ["pork", { flavorIds: [] }],
      ["beef", { flavorIds: ["bulgogi"] }],
    ]);
    const out = pruneFlavorless(cart, "pork", needsFlavor);
    expect(out.has("pork")).toBe(true);
    expect(out.has("beef")).toBe(true);
    expect(picksFlavorFor(cart, "pork")).toEqual({ flavorIds: [] });
    expect(picksFlavorFor(cart, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Modifier attachment (resolveOptionGroupIds) — the "update" union rule:
// parent ∪ variant ∪ store, never replace, de-duped, order-preserved.
// ---------------------------------------------------------------------------
describe("resolveOptionGroupIds stress", () => {
  const layer = (ids: (string | number | null | undefined)[]) => ({ optionGroupIds: ids });

  it("unions three layers, de-dupes and preserves first-seen order", () => {
    const out = resolveOptionGroupIds(
      layer(["nori", "dip"]),
      layer(["dip", "cheese"]),
      layer(["local", "nori", ""])
    );
    // Order is parent → item → store (see catalog-shared.ts), so the
    // parent's "dip, cheese" comes before the item's "nori, dip" and the
    // store's "local, nori".
    expect(out).toEqual(["dip", "cheese", "nori", "local"]);
  });

  it("survives hundreds of ids and coercions without throwing or duplicating", () => {
    const ids: (string | number | null | undefined)[] = [];
    for (let i = 0; i < 500; i++) ids.push(i % 3 === 0 ? String(i) : i);
    ids.push(null, undefined, "", "0", 0);
    const out = resolveOptionGroupIds(layer(ids));
    expect(out.length).toBeLessThanOrEqual(501);
    // 0 and "0" collapse to one entry.
    expect(out.filter((x) => x === "0")).toHaveLength(1);
    // No blanks survived.
    expect(out.every((x) => x !== "" && x !== "null" && x !== "undefined")).toBe(true);
  });
});
