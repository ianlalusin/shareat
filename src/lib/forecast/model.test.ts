import { describe, it, expect } from "vitest";
import {
  emptyModel, learnDay, forecastDay, paydayLiftPct, rainLiftPct,
  foldAccuracy, wape, bias, symmetricAccuracy, type DayContext, type ForecastModel,
} from "@/lib/forecast/model";

const ctx = (date: string, dow: number, over: Partial<DayContext> = {}): DayContext =>
  ({ date, dow, holiday: null, rain: false, payday: null, ...over });

/** Thursday (dow 4) with an established baseline of ₱30,000. */
function seeded(): ForecastModel {
  const m = emptyModel("s1");
  m.weekday["4"] = { base: 30000, mad: 0.1, samples: 5 };
  m.weekday["5"] = { base: 30000, mad: 0.1, samples: 8 };
  m.processedThrough = "2026-09-30";
  return m;
}

describe("emptyModel", () => {
  it("has seven empty weekdays and version 1", () => {
    const m = emptyModel("s1");
    expect(m.version).toBe(1);
    expect(Object.keys(m.weekday)).toHaveLength(7);
    expect(m.weekday["0"].samples).toBe(0);
    expect(m.processedThrough).toBe("");
  });
});

describe("learnDay", () => {
  it("first sample of a weekday sets its baseline", () => {
    const m = learnDay(emptyModel("s1"), ctx("2026-10-01", 4), 30000);
    expect(m.weekday["4"]).toMatchObject({ base: 30000, samples: 1 });
    expect(m.processedThrough).toBe("2026-10-01");
  });

  it("moves the baseline 25% toward a normal day and updates mad", () => {
    const m = learnDay(seeded(), ctx("2026-10-01", 4), 34000);
    expect(m.weekday["4"].base).toBeCloseTo(31000, 6);
    expect(m.weekday["4"].samples).toBe(6);
    expect(m.weekday["4"].mad).toBeCloseTo(0.1 + 0.25 * (4000 / 30000 - 0.1), 6);
  });

  it("clips a one-off huge day to 2x so it cannot wreck the baseline", () => {
    const m = learnDay(seeded(), ctx("2026-10-01", 4), 90000);
    expect(m.weekday["4"].base).toBeCloseTo(37500, 6); // 30000 + .25*(60000-30000)
  });

  it("learns a rain effect and keeps evidence", () => {
    const m = learnDay(seeded(), ctx("2026-10-01", 4, { rain: true }), 27000);
    expect(m.rain.samples).toBe(1);
    expect(m.rain.rawLogLift).toBeCloseTo(Math.log(0.9), 9);
    expect(rainLiftPct(m)).toBeCloseTo(-2.5, 6); // -10% shrunk by 1/(1+3)
    expect(m.rain.evidence).toEqual([{ date: "2026-10-01", expected: 30000, actual: 27000 }]);
  });

  it("updates both the payday cell and its pooled offset, noting a shifted payday", () => {
    const hit = { offset: 0 as const, cls: "fri" as const, shiftedFrom: "2026-10-10", payday: "2026-10-09" };
    const m = learnDay(seeded(), ctx("2026-10-09", 5, { payday: hit }), 36000);
    expect(m.payday["0_fri"].samples).toBe(1);
    expect(m.payday["0_all"].samples).toBe(1);
    expect(m.payday["0_fri"].evidence[0].note).toBe("shifted from Sat 2026-10-10");
  });

  it("holiday days advance processedThrough but change neither baseline nor factors", () => {
    const before = seeded();
    const m = learnDay(before, ctx("2026-10-01", 4, { holiday: { name: "X", liftPct: 30 }, rain: true }), 50000);
    expect(m.weekday["4"]).toEqual(before.weekday["4"]);
    expect(m.rain.samples).toBe(0);
    expect(m.processedThrough).toBe("2026-10-01");
  });

  it("zero-sales (closed) days only advance processedThrough", () => {
    const m = learnDay(seeded(), ctx("2026-10-01", 4), 0);
    expect(m.weekday["4"].samples).toBe(5);
    expect(m.processedThrough).toBe("2026-10-01");
  });

  it("re-learning an already processed day is a no-op (returns the same object)", () => {
    const m = seeded();
    expect(learnDay(m, ctx("2026-09-30", 3), 99999)).toBe(m);
  });

  it("does not mutate its input", () => {
    const m = seeded();
    learnDay(m, ctx("2026-10-01", 4), 34000);
    expect(m.weekday["4"].base).toBe(30000);
  });
});

describe("payday shrinkage", () => {
  const hit = { offset: 0 as const, cls: "fri" as const, shiftedFrom: null, payday: "2026-10-09" };
  it("an unseen cell uses the shrunk pooled estimate", () => {
    const m = seeded();
    m.payday["0_all"] = { liftPct: 0, rawLogLift: Math.log(1.2), samples: 6, evidence: [] };
    expect(paydayLiftPct(m, hit)).toBeCloseTo(20 * 6 / 9, 6); // 13.33
  });
  it("a cell with samples blends its own value with the pooled one", () => {
    const m = seeded();
    m.payday["0_all"] = { liftPct: 0, rawLogLift: Math.log(1.2), samples: 6, evidence: [] };
    m.payday["0_fri"] = { liftPct: 0, rawLogLift: Math.log(1.4), samples: 3, evidence: [] };
    expect(paydayLiftPct(m, hit)).toBeCloseTo((3 * 40 + 3 * (20 * 6 / 9)) / 6, 6); // 26.67
  });
});

describe("forecastDay", () => {
  it("returns null for a weekday with no baseline", () => {
    expect(forecastDay(emptyModel("s1"), ctx("2026-10-11", 0))).toBeNull();
  });

  it("multiplies baseline by the payday lift and explains it", () => {
    const m = seeded();
    m.payday["0_all"] = { liftPct: 0, rawLogLift: Math.log(1.2), samples: 6, evidence: [] };
    m.payday["0_fri"] = { liftPct: 0, rawLogLift: Math.log(1.4), samples: 3, evidence: [] };
    const hit = { offset: 0 as const, cls: "fri" as const, shiftedFrom: null, payday: "2026-10-09" };
    const f = forecastDay(m, ctx("2026-10-09", 5, { payday: hit }))!;
    expect(f.sales).toBe(38000);
    expect(f.confidence).toBe("high");
    expect(f.drivers).toEqual(["Fri baseline ₱30,000", "payday +27% (Fri payday, payday itself, 3 days)"]);
  });

  it("drops confidence one level when an active factor has fewer than 3 samples", () => {
    const m = seeded();
    m.rain = { liftPct: 0, rawLogLift: Math.log(0.9), samples: 1, evidence: [] };
    const f = forecastDay(m, ctx("2026-10-09", 5, { rain: true }))!;
    expect(f.confidence).toBe("medium");
    expect(f.drivers[1]).toBe("PM rain −3% (1 day)");
  });

  it("applies a measured holiday lift; an unmeasured holiday lowers confidence", () => {
    const m = seeded();
    expect(forecastDay(m, ctx("2026-10-09", 5, { holiday: { name: "Fiesta", liftPct: 50 } }))!.sales).toBe(45000);
    const u = forecastDay(m, ctx("2026-10-09", 5, { holiday: { name: "Fiesta", liftPct: null } }))!;
    expect(u.sales).toBe(30000);
    expect(u.confidence).toBe("medium");
    expect(u.drivers[1]).toBe("Fiesta — no history yet");
  });
});

describe("accuracy helpers", () => {
  it("folds decayed sums and computes WAPE and bias", () => {
    let a = { absErr: 0, actual: 0, signedErr: 0, n: 0 };
    a = foldAccuracy(a, 110, 100);
    a = foldAccuracy(a, 90, 100);
    expect(a.n).toBe(2);
    expect(wape(a)).toBeCloseTo((10 * (27 / 28) + 10) / (100 * (27 / 28) + 100), 9);
    expect(bias(a)).toBeCloseTo((10 * (27 / 28) - 10) / (100 * (27 / 28) + 100), 9);
    expect(wape({ absErr: 0, actual: 0, signedErr: 0, n: 0 })).toBeNull();
  });
  it("symmetricAccuracy matches the existing formula", () => {
    expect(symmetricAccuracy(100, 80)).toBeCloseTo(0.8, 9);
    expect(symmetricAccuracy(80, 100)).toBeCloseTo(0.8, 9);
  });
});
