import { describe, it, expect } from "vitest";
import { extractAnchor, buildLocale } from "@/lib/holidays/geo-locale";

// Trimmed shapes of real Geocoding API responses captured 2026-08-22.
const lipa = {
  status: "OK",
  results: [
    {
      address_components: [
        { long_name: "W4WX+M4W", types: ["plus_code"] },
        { long_name: "Bulacnin", types: ["sublocality", "political"] },
        { long_name: "Lipa City", types: ["locality", "political"] },
        { long_name: "Batangas", types: ["administrative_area_level_2", "political"] },
        { long_name: "Calabarzon", types: ["administrative_area_level_1", "political"] },
        { long_name: "Philippines", types: ["country", "political"] },
      ],
    },
    {
      address_components: [
        { long_name: "San Carlos", types: ["sublocality_level_1", "sublocality", "political"] },
        { long_name: "Lipa City", types: ["locality", "political"] },
      ],
    },
  ],
};

const davao = {
  status: "OK",
  results: [
    {
      address_components: [
        { long_name: "Talomo", types: ["sublocality_level_1", "sublocality", "political"] },
        { long_name: "Davao City", types: ["locality", "political"] },
        { long_name: "Davao del Sur", types: ["administrative_area_level_2", "political"] },
        { long_name: "Philippines", types: ["country", "political"] },
      ],
    },
  ],
};

describe("extractAnchor", () => {
  it("takes locality, province and country", () => {
    expect(extractAnchor(davao)).toEqual({
      locality: "Davao City",
      province: "Davao del Sur",
      country: "Philippines",
    });
  });

  it("ignores sublocality entirely — it is unreliable and can conflict", () => {
    const a = extractAnchor(lipa);
    expect(a).toEqual({ locality: "Lipa City", province: "Batangas", country: "Philippines" });
    expect(JSON.stringify(a)).not.toContain("Bulacnin");
    expect(JSON.stringify(a)).not.toContain("San Carlos");
  });

  it("returns null for a non-OK or empty response", () => {
    expect(extractAnchor({ status: "ZERO_RESULTS", results: [] })).toBeNull();
    expect(extractAnchor({ status: "REQUEST_DENIED", error_message: "nope" })).toBeNull();
    expect(extractAnchor(null)).toBeNull();
    expect(extractAnchor(undefined)).toBeNull();
  });

  it("returns null when OK but no usable components", () => {
    expect(extractAnchor({ status: "OK", results: [{ address_components: [{ long_name: "X", types: ["plus_code"] }] }] })).toBeNull();
  });
});

describe("buildLocale", () => {
  const anchor = { locality: "Lipa City", province: "Batangas", country: "Philippines" };

  it("anchors a vague address to the verified city — the Manila bug", () => {
    expect(buildLocale("Calle Arzobispado", anchor)).toBe(
      "Calle Arzobispado (verified location: Lipa City, Batangas, Philippines)",
    );
  });

  it("keeps barangay detail from the address alongside the anchor", () => {
    expect(buildLocale("Santiago, Malvar, Batangas", { locality: "Malvar", province: "Batangas", country: "Philippines" })).toBe(
      "Santiago, Malvar, Batangas (verified location: Malvar, Batangas, Philippines)",
    );
  });

  it("falls back to the address alone when there is no anchor", () => {
    expect(buildLocale("Santiago, Malvar, Batangas", null)).toBe("Santiago, Malvar, Batangas");
  });

  it("uses the anchor alone when there is no address", () => {
    expect(buildLocale(undefined, anchor)).toBe("Lipa City, Batangas, Philippines");
    expect(buildLocale("   ", anchor)).toBe("Lipa City, Batangas, Philippines");
  });

  it("falls back to Philippines when it has neither", () => {
    expect(buildLocale(undefined, null)).toBe("Philippines");
    expect(buildLocale("", null)).toBe("Philippines");
  });

  it("tolerates a partial anchor", () => {
    expect(buildLocale("Somewhere", { locality: "Malvar" })).toBe("Somewhere (verified location: Malvar)");
    expect(buildLocale(undefined, { province: "Batangas", country: "Philippines" })).toBe("Batangas, Philippines");
  });
});
