import { describe, it, expect } from "vitest";
import { parsePriceDraft, formatPriceDraft, priceDraftChanged } from "@/lib/inventory/quick-edit";

/**
 * The inline price cells on the manager inventory table write straight to
 * Firestore on blur, and two of the three fields are what a customer is
 * charged. Everything the cell decides — is this valid, did it actually
 * change, what number gets stored — lives here so it can be tested without
 * rendering React (this repo's vitest runs in a node environment).
 */

describe("parsePriceDraft", () => {
  const required = { allowEmpty: false };
  const optional = { allowEmpty: true };

  it("reads a plain number", () => {
    expect(parsePriceDraft("249", required)).toEqual({ ok: true, value: 249 });
  });

  it("reads decimals and ignores surrounding whitespace", () => {
    expect(parsePriceDraft("  249.50  ", required)).toEqual({ ok: true, value: 249.5 });
  });

  it("accepts zero — it is a real price, not an error", () => {
    expect(parsePriceDraft("0", required)).toEqual({ ok: true, value: 0 });
  });

  it("rounds to centavos so no sub-centavo price is ever stored", () => {
    expect(parsePriceDraft("249.999", required)).toEqual({ ok: true, value: 250 });
    expect(parsePriceDraft("1.005", required)).toEqual({ ok: true, value: 1.01 });
  });

  it("rejects a negative price", () => {
    const r = parsePriceDraft("-50", required);
    expect(r.ok).toBe(false);
  });

  it("rejects text", () => {
    expect(parsePriceDraft("abc", required).ok).toBe(false);
  });

  /**
   * The reason this uses Number() and not parseFloat(): parseFloat("249abc")
   * returns 249, so a typo would silently store a price the manager never
   * typed. A price cell may never guess.
   */
  it("rejects a number with trailing junk rather than silently taking the digits", () => {
    expect(parsePriceDraft("249abc", required).ok).toBe(false);
  });

  it("rejects Infinity", () => {
    expect(parsePriceDraft("Infinity", required).ok).toBe(false);
  });

  it("treats blank as 'no override' when the field is optional", () => {
    expect(parsePriceDraft("", optional)).toEqual({ ok: true, value: null });
    expect(parsePriceDraft("   ", optional)).toEqual({ ok: true, value: null });
  });

  it("refuses to blank a required field", () => {
    expect(parsePriceDraft("", required).ok).toBe(false);
  });
});

describe("priceDraftChanged", () => {
  it("is false when the value is untouched, so no write and no republish happen", () => {
    expect(priceDraftChanged(249, 249)).toBe(false);
    expect(priceDraftChanged(null, null)).toBe(false);
    expect(priceDraftChanged(undefined, null)).toBe(false);
  });

  it("is true for a real edit", () => {
    expect(priceDraftChanged(249, 299)).toBe(true);
    expect(priceDraftChanged(null, 299)).toBe(true);
    expect(priceDraftChanged(299, null)).toBe(true);
  });

  it("treats a stored 0 and a cleared field as different, so clearing writes null", () => {
    expect(priceDraftChanged(0, null)).toBe(true);
  });

  it("ignores float dust that rounds to the same centavo", () => {
    expect(priceDraftChanged(249.00000000001, 249)).toBe(false);
  });
});

describe("formatPriceDraft", () => {
  it("shows an unset optional price as an empty box, not as 0", () => {
    expect(formatPriceDraft(null)).toBe("");
    expect(formatPriceDraft(undefined)).toBe("");
  });

  it("shows a real value, including zero", () => {
    expect(formatPriceDraft(249.5)).toBe("249.5");
    expect(formatPriceDraft(0)).toBe("0");
  });
});
