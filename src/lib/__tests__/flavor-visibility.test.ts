import { describe, expect, it } from "vitest";
import { filterVisibleStoreFlavors, globallyInactiveFlavorIds } from "@/lib/flavor-visibility";

describe("global flavor visibility", () => {
  it("hides explicitly inactive global flavors while retaining store-disabled and missing-global behavior", () => {
    const inactive = globallyInactiveFlavorIds([
      { id: "off", isActive: false },
      { id: "on", isActive: true },
    ]);
    const flavors = [
      { flavorId: "off", isEnabled: true },
      { flavorId: "on", isEnabled: true },
      { flavorId: "missing", isEnabled: true },
      { flavorId: "store-off", isEnabled: false },
    ];

    expect(filterVisibleStoreFlavors(flavors, inactive)).toEqual([
      { flavorId: "on", isEnabled: true },
      { flavorId: "missing", isEnabled: true },
    ]);
  });

  it("treats an absent global active flag as active for legacy documents", () => {
    expect(globallyInactiveFlavorIds([{ id: "legacy" }]).has("legacy")).toBe(false);
  });
});
