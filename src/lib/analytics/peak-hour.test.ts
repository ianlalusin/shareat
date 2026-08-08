import { describe, it, expect, afterAll } from "vitest";
import { getPeakHourContribution, getDayOfWeekContribution } from "@/lib/analytics/daily";
import { getContributions, pickDayContribution, affectedDayIds } from "@/lib/analytics/delta-core";
import { aggregateDailyMetrics } from "@/lib/analytics/backfill-core";
import type { Receipt, Store } from "@/lib/types";

// Peak-hour / day-of-week buckets must reflect the MANILA wall clock regardless of
// the host timezone. Prod (Cloud Run) runs in UTC while dev machines run Asia/Manila,
// so any use of Date#getHours()/getDay() silently shifts the whole chart by 8 hours
// in production only. These tests pin the Manila answer under both timezones.
const HOST_TZ = process.env.TZ;
afterAll(() => {
  process.env.TZ = HOST_TZ;
});

function receipt(sessionStartIso: string, paidIso: string, total = 1000): Receipt {
  return {
    id: "r1",
    status: "paid",
    total,
    createdAtClientMs: new Date(paidIso).getTime(),
    analytics: {
      sessionStartedAtClientMs: new Date(sessionStartIso).getTime(),
      grandTotal: total,
    },
  } as unknown as Receipt;
}

describe("getPeakHourContribution — Manila hour bucketing", () => {
  for (const tz of ["UTC", "Asia/Manila"]) {
    it(`buckets a 2:30 PM Manila session into hour 14 (host TZ=${tz})`, () => {
      process.env.TZ = tz;
      const c = getPeakHourContribution(receipt("2026-08-03T14:30:00+08:00", "2026-08-03T16:00:00+08:00"));
      expect(c.hourKey).toBe("14");
    });

    it(`buckets a 7:00 PM Manila dinner rush into hour 19 (host TZ=${tz})`, () => {
      process.env.TZ = tz;
      const c = getPeakHourContribution(receipt("2026-08-03T19:00:00+08:00", "2026-08-03T21:00:00+08:00"));
      expect(c.hourKey).toBe("19");
    });

    it(`buckets a 12:30 AM Manila session into hour 0, same Manila day (host TZ=${tz})`, () => {
      process.env.TZ = tz;
      const c = getPeakHourContribution(receipt("2026-08-03T00:30:00+08:00", "2026-08-03T02:00:00+08:00"));
      expect(c.hourKey).toBe("0");
      expect(c.dayId).toBe("20260803");
    });
  }
});

// A party that arrives before midnight and pays after it is the case that made the
// chart show a spike on a day nothing happened. Arrival families (peak hour, DOW) must
// land in the ARRIVAL day doc; payment families stay in the payment day doc.
const CROSS_MIDNIGHT = () => receipt("2026-08-02T23:30:00+08:00", "2026-08-03T00:30:00+08:00", 5000);

describe("cross-midnight session routing", () => {
  it("routes arrival families to the arrival day, payment families to the payment day", () => {
    const c = getContributions(CROSS_MIDNIGHT());
    expect(c.peak.dayId).toBe("20260802");
    expect(c.peak.hourKey).toBe("23");
    expect(c.dow.dayId).toBe("20260802");
    expect(c.payment.dayId).toBe("20260803");
  });

  it("counts both days as affected", () => {
    const c = getContributions(CROSS_MIDNIGHT());
    const nil = getContributions(null);
    expect(affectedDayIds(nil, c).sort()).toEqual(["20260802", "20260803"]);
  });

  it("pickDayContribution gives the arrival day only the hour/dow, no revenue", () => {
    const c = getContributions(CROSS_MIDNIGHT());
    const aug2 = pickDayContribution(c, "20260802");
    expect(aug2.peak.hourKey).toBe("23");
    expect(aug2.peak.amount).toBe(5000);
    expect(aug2.payment.txCount).toBe(0);
    expect(aug2.payment.totalGross).toBe(0);
  });

  it("pickDayContribution gives the payment day the revenue but no hour bucket", () => {
    const c = getContributions(CROSS_MIDNIGHT());
    const aug3 = pickDayContribution(c, "20260803");
    expect(aug3.payment.dayId).toBe("20260803");
    expect(aug3.peak.hourKey).toBeNull();
    expect(aug3.peak.amount).toBe(0);
    expect(aug3.dow.dowKey).toBeNull();
  });

  it("does not double-count the amount across the two days", () => {
    const c = getContributions(CROSS_MIDNIGHT());
    const aug2 = pickDayContribution(c, "20260802");
    const aug3 = pickDayContribution(c, "20260803");
    expect(aug2.peak.amount + aug3.peak.amount).toBe(5000);
    expect(aug2.peak.count + aug3.peak.count).toBe(1);
  });
});

// Day docs are written with merge:false, so aggregateDailyMetrics must never emit a day
// outside the requested window — doing so would overwrite that day's real analytics with
// a near-empty doc. Receipts are now read a day wider, which makes this reachable.
describe("aggregateDailyMetrics — rebuild window containment", () => {
  const day = (iso: string) => new Date(iso).getTime();
  const base = {
    tickets: [],
    verifiedSessions: [],
    store: {} as Store,
    storeId: "s1",
  };

  it("never emits a day doc outside the rebuild window", () => {
    const out = aggregateDailyMetrics({
      ...base,
      receipts: [CROSS_MIDNIGHT()],
      startInclusiveMs: day("2026-08-03T00:00:00+08:00"),
      endExclusiveMs: day("2026-08-04T00:00:00+08:00"),
    });
    expect([...out.keys()]).toEqual(["20260803"]);
  });

  it("keeps the out-of-window arrival hour out of the in-window day", () => {
    const out = aggregateDailyMetrics({
      ...base,
      receipts: [CROSS_MIDNIGHT()],
      startInclusiveMs: day("2026-08-03T00:00:00+08:00"),
      endExclusiveMs: day("2026-08-04T00:00:00+08:00"),
    });
    const aug3 = out.get("20260803")!;
    expect(aug3.sales!.salesAmountByHour["23"]).toBeUndefined();
    expect(aug3.payments!.totalGross).toBeGreaterThan(0);
  });

  it("credits the arrival hour when the ARRIVAL day is the one being rebuilt", () => {
    const out = aggregateDailyMetrics({
      ...base,
      receipts: [CROSS_MIDNIGHT()],
      startInclusiveMs: day("2026-08-02T00:00:00+08:00"),
      endExclusiveMs: day("2026-08-03T00:00:00+08:00"),
    });
    expect([...out.keys()]).toEqual(["20260802"]);
    const aug2 = out.get("20260802")!;
    expect(aug2.sales!.salesAmountByHour["23"]).toBe(5000);
    expect(aug2.sales!.sessionCountByHour["23"]).toBe(1);
    // Revenue belongs to Aug 3, which is outside this window.
    expect(aug2.payments!.totalGross).toBe(0);
  });
});

describe("getDayOfWeekContribution — Manila day-of-week", () => {
  for (const tz of ["UTC", "Asia/Manila"]) {
    // 2026-08-03 is a Monday in Manila => dowKey "1".
    it(`reports Monday for a Monday-morning Manila session (host TZ=${tz})`, () => {
      process.env.TZ = tz;
      const c = getDayOfWeekContribution(receipt("2026-08-03T09:00:00+08:00", "2026-08-03T11:00:00+08:00"));
      expect(c.dowKey).toBe("1");
    });

    it(`reports Monday for a Monday 11:30 PM Manila session (host TZ=${tz})`, () => {
      process.env.TZ = tz;
      const c = getDayOfWeekContribution(receipt("2026-08-03T23:30:00+08:00", "2026-08-04T00:30:00+08:00"));
      expect(c.dowKey).toBe("1");
    });
  }
});
