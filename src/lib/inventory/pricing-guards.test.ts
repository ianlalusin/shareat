import { describe, it, expect } from "vitest";
import {
  onlineUndercutsStore,
  pricingWarnings,
  sellsBelowCost,
  undercutPercent,
} from "@/lib/inventory/pricing-guards";

describe("sellsBelowCost", () => {
  it("flags a selling price under a known cost", () => {
    expect(sellsBelowCost(100, 80)).toBe(true);
  });

  it("allows selling exactly at cost", () => {
    expect(sellsBelowCost(100, 100)).toBe(false);
  });

  it("allows a healthy margin", () => {
    expect(sellsBelowCost(100, 150)).toBe(false);
  });

  it("never blocks when cost is unset — 0 means 'not costed yet', not free", () => {
    expect(sellsBelowCost(0, 50)).toBe(false);
    expect(sellsBelowCost(undefined, 50)).toBe(false);
    expect(sellsBelowCost(null, 50)).toBe(false);
  });

  it("ignores a zero selling price, which other rules already reject", () => {
    expect(sellsBelowCost(100, 0)).toBe(false);
  });

  it("survives junk rather than throwing", () => {
    expect(sellsBelowCost("abc", "def")).toBe(false);
  });
});

describe("onlineUndercutsStore", () => {
  it("flags an online price more than 15% under the store price", () => {
    expect(onlineUndercutsStore(100, 84)).toBe(true);
  });

  it("does NOT flag exactly 15% under — the threshold is the allowance", () => {
    expect(onlineUndercutsStore(100, 85)).toBe(false);
  });

  it("does not flag an online price at or above the store price", () => {
    expect(onlineUndercutsStore(100, 100)).toBe(false);
    expect(onlineUndercutsStore(100, 120)).toBe(false);
  });

  it("treats an unset online price as 'matches the store price', not an undercut", () => {
    expect(onlineUndercutsStore(100, null)).toBe(false);
    expect(onlineUndercutsStore(100, undefined)).toBe(false);
    expect(onlineUndercutsStore(100, "")).toBe(false);
  });

  it("does not flag a withheld (0) online price — that is a different state", () => {
    expect(onlineUndercutsStore(100, 0)).toBe(false);
  });

  it("reports how far under, for the warning copy", () => {
    expect(undercutPercent(100, 70)).toBe(30);
  });
});

describe("pricingWarnings", () => {
  const ok = { cost: 50, sellingPrice: 100, onlinePrice: 100, onlineEnabled: true };

  it("returns nothing for a healthy row", () => {
    expect(pricingWarnings(ok)).toEqual([]);
  });

  it("reports a below-cost row", () => {
    const w = pricingWarnings({ ...ok, sellingPrice: 40 });
    expect(w.map((x) => x.kind)).toContain("below_cost");
  });

  it("reports an online undercut only while the item is offered online", () => {
    const offered = pricingWarnings({ ...ok, onlinePrice: 50 });
    expect(offered.map((x) => x.kind)).toContain("online_undercut");

    const notOffered = pricingWarnings({ ...ok, onlinePrice: 50, onlineEnabled: false });
    expect(notOffered).toEqual([]);
  });

  it("reports both at once when both are wrong", () => {
    // Cost 50, store price 45 (below cost), online 30 (33% under store).
    const w = pricingWarnings({ cost: 50, sellingPrice: 45, onlinePrice: 30, onlineEnabled: true });
    expect(w.map((x) => x.kind).sort()).toEqual(["below_cost", "online_undercut"]);
  });
});
