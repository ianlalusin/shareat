import { describe, it, expect } from "vitest";
import {
  POPULAR_DISPLAY_LIMIT,
  mergePopularityDeltas,
  popularityDeltaFromReceipt,
  topPopularIds,
} from "./popular-items";

const receipt = (lines: any[], over: Record<string, any> = {}) => ({
  id: "r1",
  lines,
  ...over,
});

const line = (over: Record<string, any> = {}) => ({
  type: "addon",
  itemId: "inv_kimbap",
  qtyOrdered: 2,
  voidedQty: 0,
  freeQty: 0,
  ...over,
});

describe("popularityDeltaFromReceipt", () => {
  it("counts what physically left the kitchen", () => {
    expect(popularityDeltaFromReceipt(receipt([line()]), 1)).toEqual({ inv_kimbap: 2 });
  });

  it("counts a free item — a comped dish was still ordered", () => {
    // Popularity is about demand, not revenue: billableQty would drop this.
    expect(popularityDeltaFromReceipt(receipt([line({ freeQty: 2 })]), 1)).toEqual({
      inv_kimbap: 2,
    });
  });

  it("does not count a voided line", () => {
    expect(popularityDeltaFromReceipt(receipt([line({ qtyOrdered: 3, voidedQty: 3 })]), 1)).toEqual({});
  });

  it("subtracts a refund", () => {
    const r = receipt([line()], { isRefund: true });
    expect(popularityDeltaFromReceipt(r, 1)).toEqual({ inv_kimbap: -2 });
  });

  it("reverses everything when the receipt is voided", () => {
    // The `void` op replays the original contribution with sign -1.
    expect(popularityDeltaFromReceipt(receipt([line()]), -1)).toEqual({ inv_kimbap: -2 });
  });

  it("ignores package lines and synthetic add-ons", () => {
    const r = receipt([
      line({ type: "package", itemId: "inv_unli" }),
      line({ itemId: "" }),
    ]);
    expect(popularityDeltaFromReceipt(r, 1)).toEqual({});
  });

  it("sums repeats of the same item across lines", () => {
    const r = receipt([line({ qtyOrdered: 1 }), line({ qtyOrdered: 3 })]);
    expect(popularityDeltaFromReceipt(r, 1)).toEqual({ inv_kimbap: 4 });
  });

  it("drops entries that net to zero rather than writing noise", () => {
    expect(popularityDeltaFromReceipt(receipt([line({ qtyOrdered: 0 })]), 1)).toEqual({});
  });
});

describe("topPopularIds", () => {
  const counts = { a: 5, b: 12, c: 1, d: 12, e: 0, f: -3 };

  it("returns the highest counts first", () => {
    expect(topPopularIds(counts, 3)).toEqual(["b", "d", "a"]);
  });

  it("breaks ties by id, so the menu does not reshuffle between reads", () => {
    expect(topPopularIds({ z: 4, a: 4 }, 2)).toEqual(["a", "z"]);
  });

  it("omits items nobody has ordered, and refund-negative ones", () => {
    expect(topPopularIds(counts, 10)).toEqual(["b", "d", "a", "c"]);
  });

  it("survives a missing or malformed map", () => {
    expect(topPopularIds(null, 5)).toEqual([]);
    expect(topPopularIds({ a: "junk" as any, b: 2 }, 5)).toEqual(["b"]);
  });

  it("defaults to the display limit", () => {
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`i${String(i).padStart(2, "0")}`, 40 - i])
    );
    expect(topPopularIds(many).length).toBe(POPULAR_DISPLAY_LIMIT);
  });
});

describe("mergePopularityDeltas", () => {
  it("adds the two together", () => {
    expect(mergePopularityDeltas({ a: 2 }, { a: 3, b: 1 })).toEqual({ a: 5, b: 1 });
  });

  it("drops keys that cancel out", () => {
    // An edit that did not touch an item must write nothing for it.
    expect(mergePopularityDeltas({ a: 2 }, { a: -2 })).toEqual({});
  });

  it("nets an edit down to what actually changed", () => {
    const before = { kimbap: -2, rice: -1 };
    const after = { kimbap: 3, rice: 1 };
    expect(mergePopularityDeltas(before, after)).toEqual({ kimbap: 1 });
  });
});
