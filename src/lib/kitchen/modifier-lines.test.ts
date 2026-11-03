import { describe, it, expect } from "vitest";
import { kitchenModifierLines } from "./modifier-lines";

const mod = (groupName: string, valueName: string) => ({
  groupId: groupName,
  groupName,
  valueId: valueName,
  valueName,
  priceDelta: 0,
});

describe("kitchenModifierLines", () => {
  it("shows the group name with the pick", () => {
    expect(kitchenModifierLines({ modifiers: [mod("Dips", "Cheese")], modifiersText: "Cheese" })).toEqual(["Dips - Cheese"]);
  });

  it("puts picks from one group on one line and each group on its own line", () => {
    expect(
      kitchenModifierLines({ modifiers: [mod("Dips", "Cheese"), mod("Size", "Large"), mod("Dips", "Garlic")] })
    ).toEqual(["Dips - Cheese, Garlic", "Size - Large"]);
  });

  it("falls back to the flat text when there are no structured modifiers", () => {
    expect(kitchenModifierLines({ modifiersText: "Extra Spicy, No Onions" })).toEqual(["Extra Spicy, No Onions"]);
    expect(kitchenModifierLines({ modifiers: [], modifiersText: "Cheese" })).toEqual(["Cheese"]);
  });

  it("shows just the value when a group has no name", () => {
    expect(kitchenModifierLines({ modifiers: [mod("", "Cheese")] })).toEqual(["Cheese"]);
  });

  it("returns nothing when there are no modifiers", () => {
    expect(kitchenModifierLines({})).toEqual([]);
    expect(kitchenModifierLines({ modifiersText: "  " })).toEqual([]);
  });
});
