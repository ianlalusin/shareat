import { describe, it, expect } from "vitest";
import { resolveOptionGroupIds } from "@/lib/server/catalog-shared";

const withGroups = (...ids: string[]) => ({ optionGroupIds: ids });

describe("resolveOptionGroupIds", () => {
  it("returns the parent's groups when the variant adds none — the inheriting case", () => {
    expect(resolveOptionGroupIds(withGroups(), withGroups("dip"))).toEqual(["dip"]);
  });

  it("returns a single product's own groups", () => {
    expect(resolveOptionGroupIds(withGroups("dip", "extras"))).toEqual(["dip", "extras"]);
  });

  it("UNIONS parent and variant rather than letting the variant replace", () => {
    // Kimbap (Signature) offers Extra Nori; the family's Dip still applies.
    expect(resolveOptionGroupIds(withGroups("nori"), withGroups("dip"))).toEqual(["dip", "nori"]);
  });

  it("adds the store's own attachment on top of both", () => {
    expect(resolveOptionGroupIds(withGroups("nori"), withGroups("dip"), withGroups("local"))).toEqual([
      "dip",
      "nori",
      "local",
    ]);
  });

  it("de-duplicates a group attached at more than one layer", () => {
    expect(resolveOptionGroupIds(withGroups("dip"), withGroups("dip"), withGroups("dip"))).toEqual(["dip"]);
  });

  it("keeps parent order first, then the item's, then the store's", () => {
    expect(
      resolveOptionGroupIds(withGroups("c"), withGroups("a", "b"), withGroups("d"))
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("survives missing, null and malformed layers rather than throwing", () => {
    expect(resolveOptionGroupIds(null)).toEqual([]);
    expect(resolveOptionGroupIds(undefined, undefined, undefined)).toEqual([]);
    expect(resolveOptionGroupIds({ optionGroupIds: "not-an-array" } as any)).toEqual([]);
    expect(resolveOptionGroupIds({} as any, {} as any)).toEqual([]);
  });

  it("drops empty ids so a stray blank cannot resolve to a group", () => {
    expect(resolveOptionGroupIds({ optionGroupIds: ["dip", "", null] } as any)).toEqual(["dip"]);
  });

  it("coerces ids to strings, since Firestore data is untyped", () => {
    expect(resolveOptionGroupIds({ optionGroupIds: [123] } as any)).toEqual(["123"]);
  });
});
