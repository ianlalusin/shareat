import { describe, it, expect } from "vitest";
import { getContributions, buildDeltaIncrements, getApplicablePresets } from "@/lib/analytics/delta-core";

describe("buildDeltaIncrements", () => {
  it("new payment (zero -> contribution) produces positive increments", () => {
    const zero = getContributions(null);
    const next = getContributions(null);
    next.payment.totalGross = 100;
    next.payment.txCount = 1;
    next.payment.discountsTotal = 11.2;
    next.payment.byMethod = { gcash: 100 };
    next.payment.mode = "dineIn";

    const inc = buildDeltaIncrements(zero, next);
    expect(inc["payments.totalGross"]).toBe(100);
    expect(inc["payments.txCount"]).toBe(1);
    expect(inc["payments.discountsTotal"]).toBe(11.2);
    expect(inc["payments.byMethod.gcash"]).toBe(100);
    expect(inc["payments.txCountByMode.dineIn"]).toBe(1);
  });

  it("reversal (contribution -> zero) produces negative increments", () => {
    const zero = getContributions(null);
    const prev = getContributions(null);
    prev.payment.totalGross = 100;
    prev.payment.txCount = 1;

    const inc = buildDeltaIncrements(prev, zero);
    expect(inc["payments.totalGross"]).toBe(-100);
    expect(inc["payments.txCount"]).toBe(-1);
  });

  it("no change produces no increment keys for unchanged fields", () => {
    const a = getContributions(null);
    const b = getContributions(null);
    b.payment.totalGross = 50;
    const inc = buildDeltaIncrements(a, b);
    expect(inc["payments.totalGross"]).toBe(50);
    expect("payments.txCount" in inc).toBe(false); // unchanged (0 delta) -> omitted
  });

  it("sanitizes dotted/slashed dynamic keys via safeKey", () => {
    const zero = getContributions(null);
    const next = getContributions(null);
    next.payment.byMethod = { "g.cash/x": 25 };
    const inc = buildDeltaIncrements(zero, next);
    expect(inc["payments.byMethod.g·cash∕x"]).toBe(25);
  });
});

describe("getApplicablePresets", () => {
  // Local-time constructors so day boundaries align with getApplicablePresets's
  // local-time atStartOfDay, making the test deterministic on any machine TZ.
  const now = new Date(2026, 5, 12, 10, 0, 0); // 2026-06-12 10:00 local

  it("same-day event is in today/last7/last30/thisMonth/ytd", () => {
    const p = getApplicablePresets(new Date(2026, 5, 12, 1, 0, 0), now);
    expect(p).toContain("today");
    expect(p).toContain("last7");
    expect(p).toContain("thisMonth");
    expect(p).toContain("ytd");
    expect(p).not.toContain("yesterday");
  });

  it("prior-day event is yesterday but not today", () => {
    const p = getApplicablePresets(new Date(2026, 5, 11, 20, 0, 0), now);
    expect(p).toContain("yesterday");
    expect(p).not.toContain("today");
  });

  it("far-past event matches no rolling preset", () => {
    const p = getApplicablePresets(new Date(2025, 0, 1, 0, 0, 0), now);
    expect(p).toEqual([]);
  });
});
