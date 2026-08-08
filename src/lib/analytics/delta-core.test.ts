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
  // Absolute instants anchored to Asia/Manila (UTC+8, no DST). getApplicablePresets
  // must bucket by the MANILA calendar day regardless of the host/server timezone.
  // Prod runs in UTC, where a Manila-midnight timestamp (16:00Z the prior day) was
  // wrongly bucketed into "yesterday" instead of "today" — sending the day's sales
  // into the wrong dashboard preset tile. These inputs use explicit +08:00 offsets
  // so they assert the same Manila bucketing on any machine TZ.
  const now = new Date("2026-06-12T10:00:00+08:00"); // 2026-06-12 10:00 PHT

  it("Manila-midnight event is today (not yesterday) on any server TZ", () => {
    // 2026-06-12 00:00 PHT === 2026-06-11T16:00Z — the exact prod regression case.
    const p = getApplicablePresets(new Date("2026-06-12T00:00:00+08:00"), now);
    expect(p).toContain("today");
    expect(p).not.toContain("yesterday");
    expect(p).toContain("last7");
    expect(p).toContain("thisMonth");
    expect(p).toContain("ytd");
  });

  it("prior Manila-day event is yesterday but not today", () => {
    const p = getApplicablePresets(new Date("2026-06-11T20:00:00+08:00"), now);
    expect(p).toContain("yesterday");
    expect(p).not.toContain("today");
  });

  it("month boundary is bucketed by the Manila calendar month", () => {
    const nowJul = new Date("2026-07-15T10:00:00+08:00");
    const jul1 = getApplicablePresets(new Date("2026-07-01T00:00:00+08:00"), nowJul);
    expect(jul1).toContain("thisMonth");
    expect(jul1).not.toContain("lastMonth");
    const jun30 = getApplicablePresets(new Date("2026-06-30T12:00:00+08:00"), nowJul);
    expect(jun30).toContain("lastMonth");
    expect(jun30).not.toContain("thisMonth");
  });

  it("far-past event matches no rolling preset", () => {
    const p = getApplicablePresets(new Date("2025-01-01T00:00:00+08:00"), now);
    expect(p).toEqual([]);
  });
});
