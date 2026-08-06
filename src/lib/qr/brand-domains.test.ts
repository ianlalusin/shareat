import { describe, expect, it } from "vitest";

import {
  ICON_HOST_ALLOWLIST,
  isAllowedIconHost,
  normalizeName,
  resolveIconCandidates,
} from "./brand-domains";

const urlsFor = (provider: string, name: string) =>
  resolveIconCandidates(provider, name).map((c) => c.url);

describe("normalizeName", () => {
  it("strips punctuation, spacing and case", () => {
    expect(normalizeName("GCash — Ate Malou")).toBe("gcashatemalou");
    expect(normalizeName("BPI")).toBe("bpi");
    expect(normalizeName("")).toBe("");
  });
});

describe("resolveIconCandidates", () => {
  it("resolves a known provider key to its curated domain", () => {
    expect(urlsFor("gcash", "Ate Malou").join(" ")).toContain("domain=gcash.com");
  });

  it("resolves from the typed name when no provider key is known", () => {
    expect(urlsFor("generic", "Maya").join(" ")).toContain("domain=maya.ph");
    expect(urlsFor("", "BPI Savings").join(" ")).toContain("domain=bpi.com.ph");
  });

  it("guesses only from the first word, never the whole label", () => {
    const urls = urlsFor("generic", "Shopee Store Front").join(" ");
    expect(urls).toContain("domain=shopee.ph");
    expect(urls).not.toContain("shopeestorefront");
  });

  it("accepts a name that is already a domain", () => {
    expect(urlsFor("", "mybank.com.ph").join(" ")).toContain("domain=mybank.com.ph");
  });

  it("offers Simple Icons last, since it 404s on a miss", () => {
    const candidates = resolveIconCandidates("gcash", "GCash");
    expect(candidates.at(-1)?.source).toBe("simpleicons");
  });

  it("returns nothing actionable for an unusable name", () => {
    // Too short to guess a domain from and not in the curated map.
    expect(resolveIconCandidates("generic", "A")).toEqual([]);
  });

  it("never emits a duplicate url", () => {
    // provider and name both resolve to gcash.com.
    const urls = urlsFor("gcash", "GCash");
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("only ever targets allowlisted hosts", () => {
    const names = ["GCash", "Maya", "mybank.com.ph", "Ate Malou", "BDO", "shopee"];
    for (const name of names) {
      for (const candidate of resolveIconCandidates("", name)) {
        expect(isAllowedIconHost(candidate.host)).toBe(true);
        expect(isAllowedIconHost(new URL(candidate.url).hostname)).toBe(true);
      }
    }
  });

  it("cannot be coerced into targeting an internal address", () => {
    // The name is only ever used to derive a slug that must look like a domain;
    // it is never used as a URL. Everything below must stay on allowlisted hosts.
    const hostile = [
      "127.0.0.1",
      "localhost",
      "169.254.169.254",
      "http://evil.test",
      "foo&domain=evil.test",
      "../../etc/passwd",
    ];
    for (const name of hostile) {
      for (const candidate of resolveIconCandidates("", name)) {
        expect(ICON_HOST_ALLOWLIST).toContain(new URL(candidate.url).hostname);
      }
    }
  });

  it("percent-encodes the domain it interpolates", () => {
    for (const candidate of resolveIconCandidates("", "foo&bar=baz.com")) {
      const parsed = new URL(candidate.url);
      // Exactly one `domain` param — no smuggled second value.
      expect(parsed.searchParams.getAll("domain").length).toBeLessThanOrEqual(1);
    }
  });
});
