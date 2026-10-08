# Learned Forecast Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "re-read 28 days and ask an LLM" with a per-store learned model doc (weekday baselines, rain and date×weekday payday factors, evidence, weekly AI reasoning) that nightly code updates and the daily forecast computes from, shadowed against the LLM until Ian switches each store.

**Architecture:**
- Three pure modules in `src/lib/forecast/`:
  - `payday.ts`: payday calendar
  - `model.ts`: learning and forecasting maths
  - `context.ts`: builds a day's context from raw docs
- A server module `src/lib/server/forecast-model.ts` does the Firestore I/O, learns inside the existing 4 AM `update-accuracy` cron, and forecasts inside the existing 5–9 AM `generate-forecast` cron.
- The LLM path keeps running in shadow (`engine: "llm"`) until `forecastConfig.engine = "model"`.

**Tech Stack:** Next.js 15 / TypeScript, firebase-admin (Firestore), vitest, Genkit + Gemini, `@anthropic-ai/sdk` (Claude, already wired in `src/ai/claude.ts`).

**Spec:** `docs/superpowers/specs/2026-10-08-learned-forecast-model-design.md`. Read it before starting any task.

## Global Constraints

- Every date is a **Manila calendar day** as `YYYY-MM-DD`. Day ids are `YYYYMMDD`. Never use server-local `new Date()` getters for calendar maths. Use string/UTC maths, or `manilaDayAnchor()` / `anchorYmd()` from `src/lib/analytics/manila-day.ts`.
- Actual sales = `analytics/{dayId}.payments.totalGross`. The analytics doc id **is** the Manila dayId; query by `FieldPath.documentId()` ranges, not `meta.dayStartMs`.
- Learning constants:

  | Constant | Value |
  |---|---|
  | weekday base α | 0.25 |
  | mad α | 0.25 |
  | factor α | 0.2 |
  | shrink K | 3 |
  | clip | [0.5×, 2×] |
  | evidence kept | 10 |
  | accuracy decay | 1/28 |
  | bootstrap | 90 days |

- Confidence: mad < 0.12 high, < 0.25 medium, else low. Drop one level for an unmeasured holiday or any active factor with fewer than 3 samples.
- Payday cells: offset ∈ {−1, 0, +1, +2} × class ∈ {`fri`, `wkday`}, plus pooled `${offset}_all`. A weekend nominal payday shifts to the preceding Friday.
- Forecast-time rain needs a `pm` (or `condition`) matching `/rain|storm|thunder/i` **and** (`pop ≥ 0.6` or a heavy/storm/thunder condition). Learn-time rain needs only the regex match.
- The AI never writes numbers into the model. It only writes `reasoning`.
- Firestore rejects `undefined` field values. Omit the key instead.
- **Do not run anything that writes to production Firestore** (the learner, forecast generation, or cron routes) without Ian's explicit OK in chat. The replay script (Task 4) is read-only and allowed.
- POS dev server port is 9003 (`npm run dev`). Stop it before `next build`.

## Deviations from the spec (decided while planning)

- **No new `semi_monthly_10_eom` schedule type.** The settings UI always saves `payrollScheduleType: "custom"` (`forecast-settings.tsx:136`), so "10th + EOM" is just custom dates `10, 31`. The fix that matters is clamping 31 to the month's last day, which is in this plan.
- **Forecast docs gain `llmSales`** in addition to `modelSales`. Accuracy is folded only on days that have both, so the shadow comparison is like-for-like, and a switch to engine = model mid-day can't pollute it.
- **The UI lives on `ForecastAccuracyTrendCard`**, the card the dashboard actually renders. `ForecastAccuracyCard.tsx` is not imported anywhere. Drivers are shown for today's forecast on that card.

## Review Focus

1. **Yesterday's analytics doc isn't synced yet at 4 AM** (offline POS). The learner must not advance past a missing day within the last 2 days; it retries next night. Older missing days are treated as closed (sales 0, skipped by `learnDay`). → Task 3 `daysToLearn` tests.
2. **The settings save overwrites `forecastConfig` wholesale** (`updateDoc(storeRef, { forecastConfig })`). The engine choice and anything else must survive a save of an unrelated field. → Task 5 `buildForecastConfig` tests.
3. **A one-off huge day** (private event, 3× normal) must not wreck the weekday baseline. → Task 2 clipping test.
4. **A new branch, or a weekday never seen yet**, has no baseline. `forecastDay` returns `null` for that day, and engine = model writes only the days it can, never `NaN` or `0`. → Task 2 null test, Task 8 skip path.
5. **Weekly or bi-weekly payroll** means every Friday is a payday, which would confound the weekday baseline. The payday factor is disabled (`paydayDaysOfMonth` → `null`). → Task 1 test.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/forecast/payday.ts` (new) | Date-string helpers, payday days-of-month from config, effective paydays (clamp + weekend shift), payday hit for a date |
| `src/lib/forecast/model.ts` (new) | `ForecastModel` types, `emptyModel`, `learnDay`, `forecastDay`, lifts and shrinkage, `foldAccuracy`, `wape`, `bias`, `symmetricAccuracy` |
| `src/lib/forecast/context.ts` (new) | `ContextSources` → `DayContext` (holiday, rain, payday), `daysToLearn` |
| `src/lib/server/forecast-model.ts` (new) | Firestore I/O: `loadForecastModel`, `loadContextSources`, `learnForecastModel`, `forecastNext7` |
| `src/ai/claude.ts` | add `explainWithClaude` |
| `src/ai/flows/explain-forecast-model.ts` (new) | `explainForecastModel`: Claude first, Gemini fallback |
| `src/ai/flows/forecast-weekly-sales.ts` | move the Claude→Gemini choice into `forecastWeeklySales`, return `provider` |
| `src/lib/server/generate-forecast.ts` | engine switch, model fields on forecast docs, learner in the accuracy cron, remove `backfillRecentAccuracy` |
| `src/lib/utils/forecast-helpers.ts` | payroll dates via `payday.ts` (Manila-safe, EOM clamp), `buildForecastConfig` |
| `src/lib/types.ts` | `ForecastConfig.engine`, `SalesForecast` model fields |
| `firestore.rules`, `tests/rules/store-scoped.test.ts` | `forecastModel` server-write only |
| `src/hooks/useForecastModel.ts` (new), `src/hooks/useForecastAnalytics.ts` | client reads |
| `src/components/dashboard/ForecastModelPanel.tsx` (new), `ForecastAccuracyTrendCard.tsx`, `DashboardPageClient.tsx` | drivers, model vs AI, reasoning |
| `src/components/manager/store-settings/forecast-settings.tsx` | engine toggle, payday hint |
| `scripts/forecast-model-replay.ts` (new) | read-only acceptance replay |

---

### Task 1: Payday calendar (pure)

**Files:**
- Create: `src/lib/forecast/payday.ts`
- Test: `src/lib/forecast/payday.test.ts`

**Interfaces:**
- Produces:
  - `ymdToMs(ymd: string): number`
  - `addDaysYmd(ymd: string, n: number): string`
  - `dowOf(ymd: string): number` (0 = Sun)
  - `paydayDaysOfMonth(config?: ForecastConfig): number[] | null`
  - `effectivePaydays(daysOfMonth: number[], fromYmd: string, toYmd: string): EffectivePayday[]`
  - `paydayHitFor(date: string, paydays: EffectivePayday[], staffConfirmed?: boolean): PaydayHit | null`
  - Types: `EffectivePayday = { date: string; nominal: string; shifted: boolean }`, `PaydayOffset = -1 | 0 | 1 | 2`, `PaydayClass = "fri" | "wkday"`, `PaydayHit = { offset: PaydayOffset; cls: PaydayClass; shiftedFrom: string | null; payday: string }`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/forecast/payday.test.ts
import { describe, it, expect } from "vitest";
import { addDaysYmd, dowOf, effectivePaydays, paydayDaysOfMonth, paydayHitFor } from "@/lib/forecast/payday";

describe("date helpers", () => {
  it("adds days across a month edge and reads the weekday from the string", () => {
    expect(addDaysYmd("2026-10-30", 3)).toBe("2026-11-02");
    expect(dowOf("2026-10-08")).toBe(4); // Thursday
  });
});

describe("paydayDaysOfMonth", () => {
  it("defaults to 15th + end of month", () => {
    expect(paydayDaysOfMonth(undefined)).toEqual([15, 31]);
  });
  it("uses custom dates", () => {
    expect(paydayDaysOfMonth({ payrollScheduleType: "custom", customPayrollDates: [10, 31] })).toEqual([10, 31]);
  });
  it("disables the payday factor for weekly and bi-weekly payroll", () => {
    expect(paydayDaysOfMonth({ payrollScheduleType: "weekly" })).toBeNull();
    expect(paydayDaysOfMonth({ payrollScheduleType: "bi_weekly" })).toBeNull();
  });
  it("returns null for custom with no dates", () => {
    expect(paydayDaysOfMonth({ payrollScheduleType: "custom", customPayrollDates: [] })).toBeNull();
  });
});

describe("effectivePaydays", () => {
  const oct = effectivePaydays([10, 31], "2026-10-01", "2026-10-31");
  it("shifts a Saturday 10th back to Friday the 9th", () => {
    expect(oct).toContainEqual({ date: "2026-10-09", nominal: "2026-10-10", shifted: true });
  });
  it("shifts a Saturday EOM back to Friday", () => {
    expect(oct).toContainEqual({ date: "2026-10-30", nominal: "2026-10-31", shifted: true });
  });
  it("keeps a weekday payday unshifted", () => {
    expect(effectivePaydays([10], "2026-09-01", "2026-09-30")).toContainEqual({ date: "2026-09-10", nominal: "2026-09-10", shifted: false });
  });
  it("clamps 31 to the month's last day (Nov 30, a Monday)", () => {
    expect(effectivePaydays([31], "2026-11-01", "2026-11-30")).toContainEqual({ date: "2026-11-30", nominal: "2026-11-30", shifted: false });
  });
  it("clamps February EOM then shifts Sat Feb 28 to Fri Feb 27", () => {
    expect(effectivePaydays([31], "2026-02-01", "2026-02-28")).toContainEqual({ date: "2026-02-27", nominal: "2026-02-28", shifted: true });
  });
  it("shifts a Sunday 15th back two days to Friday", () => {
    expect(effectivePaydays([15], "2026-11-01", "2026-11-30")).toContainEqual({ date: "2026-11-13", nominal: "2026-11-15", shifted: true });
  });
  it("includes the previous month's paydays so early-month dates see a +1/+2 offset", () => {
    expect(effectivePaydays([31], "2026-11-01", "2026-11-02").map((p) => p.date)).toContain("2026-10-30");
  });
  it("is sorted and de-duplicated", () => {
    const ds = effectivePaydays([30, 31], "2026-10-01", "2026-10-31").map((p) => p.date);
    expect(ds).toEqual([...new Set(ds)].sort());
  });
});

describe("paydayHitFor", () => {
  const pays = effectivePaydays([10, 31], "2026-10-01", "2026-10-31");
  it("labels the shifted Friday payday as offset 0, class fri", () => {
    expect(paydayHitFor("2026-10-09", pays)).toEqual({ offset: 0, cls: "fri", shiftedFrom: "2026-10-10", payday: "2026-10-09" });
  });
  it("covers the day before and two days after", () => {
    expect(paydayHitFor("2026-10-08", pays)?.offset).toBe(-1);
    expect(paydayHitFor("2026-10-10", pays)?.offset).toBe(1);
    expect(paydayHitFor("2026-10-11", pays)?.offset).toBe(2);
    expect(paydayHitFor("2026-10-12", pays)).toBeNull();
  });
  it("classes a Thursday payday as wkday", () => {
    const sep = effectivePaydays([10], "2026-09-01", "2026-09-30");
    expect(paydayHitFor("2026-09-10", sep)?.cls).toBe("wkday");
  });
  it("on overlap, the nearest payday wins; ties go to the payday already passed", () => {
    const close = effectivePaydays([5, 7], "2026-10-01", "2026-10-31"); // Mon 5th, Wed 7th
    expect(paydayHitFor("2026-10-06", close)).toMatchObject({ offset: 1, payday: "2026-10-05" });
    expect(paydayHitFor("2026-10-07", close)).toMatchObject({ offset: 0, payday: "2026-10-07" });
  });
  it("a staff-confirmed payday with no computed one becomes an offset-0 hit", () => {
    expect(paydayHitFor("2026-10-20", pays, true)).toEqual({ offset: 0, cls: "wkday", shiftedFrom: null, payday: "2026-10-20" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/forecast/payday.test.ts`
Expected: FAIL, "Failed to resolve import @/lib/forecast/payday".

- [ ] **Step 3: Implement**

```ts
// src/lib/forecast/payday.ts
// Pure — no Firestore, no Date getters in local time. Dates are Manila calendar
// days as YYYY-MM-DD; all maths is on UTC midnights of those strings.
import type { ForecastConfig } from "@/lib/types";

export type EffectivePayday = { date: string; nominal: string; shifted: boolean };
export type PaydayOffset = -1 | 0 | 1 | 2;
export type PaydayClass = "fri" | "wkday";
export type PaydayHit = { offset: PaydayOffset; cls: PaydayClass; shiftedFrom: string | null; payday: string };

const DAY_MS = 86_400_000;

export function ymdToMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`);
}
function msToYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDaysYmd(ymd: string, n: number): string {
  return msToYmd(ymdToMs(ymd) + n * DAY_MS);
}
export function dowOf(ymd: string): number {
  return new Date(ymdToMs(ymd)).getUTCDay();
}

/** Days of the month that are paydays, or null when the payday factor does not apply. */
export function paydayDaysOfMonth(config?: ForecastConfig): number[] | null {
  const type = config?.payrollScheduleType ?? "semi_monthly_15_eom";
  // Weekly/bi-weekly: every (other) Friday is payday — indistinguishable from
  // the Friday weekday baseline, so the factor is off.
  if (type === "weekly" || type === "bi_weekly") return null;
  if (type === "custom") return config?.customPayrollDates?.length ? [...config.customPayrollDates] : null;
  return [15, 31];
}

/**
 * Effective paydays touching [fromYmd, toYmd], padded one month each side so
 * offsets −1..+2 near a month edge still resolve. A day-of-month past the
 * month's end clamps to the last day (31 = EOM); a Sat/Sun payday moves to
 * the preceding Friday (salary released early).
 */
export function effectivePaydays(daysOfMonth: number[], fromYmd: string, toYmd: string): EffectivePayday[] {
  const out = new Map<string, EffectivePayday>();
  const [fy, fm] = fromYmd.split("-").map(Number);
  const [ty, tm] = toYmd.split("-").map(Number);
  // idx = year*12 + zero-based month; fm/tm are 1-based.
  for (let idx = fy * 12 + fm - 2; idx <= ty * 12 + tm; idx++) {
    const y = Math.floor(idx / 12);
    const m = idx % 12;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (const dom of daysOfMonth) {
      if (!Number.isInteger(dom) || dom < 1 || dom > 31) continue;
      const nominal = msToYmd(Date.UTC(y, m, Math.min(dom, lastDay)));
      const dow = dowOf(nominal);
      const back = dow === 6 ? 1 : dow === 0 ? 2 : 0;
      const date = addDaysYmd(nominal, -back);
      if (!out.has(date)) out.set(date, { date, nominal, shifted: back > 0 });
    }
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Which payday window (if any) a date falls in. Nearest payday wins; ties go to the one already passed. */
export function paydayHitFor(date: string, paydays: EffectivePayday[], staffConfirmed = false): PaydayHit | null {
  let best: PaydayHit | null = null;
  const t = ymdToMs(date);
  for (const p of paydays) {
    const off = Math.round((t - ymdToMs(p.date)) / DAY_MS);
    if (off < -1 || off > 2) continue;
    if (best) {
      const closer = Math.abs(off) < Math.abs(best.offset);
      const tieButLater = Math.abs(off) === Math.abs(best.offset) && off > best.offset;
      if (!closer && !tieButLater) continue;
    }
    best = { offset: off as PaydayOffset, cls: dowOf(p.date) === 5 ? "fri" : "wkday", shiftedFrom: p.shifted ? p.nominal : null, payday: p.date };
  }
  if (!best && staffConfirmed) {
    best = { offset: 0, cls: dowOf(date) === 5 ? "fri" : "wkday", shiftedFrom: null, payday: date };
  }
  return best;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/forecast/payday.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forecast/payday.ts src/lib/forecast/payday.test.ts
git commit -m "feat(forecast): pure payday calendar with EOM clamp and weekend shift"
```

---

### Task 2: Model maths (pure)

**Files:**
- Create: `src/lib/forecast/model.ts`
- Test: `src/lib/forecast/model.test.ts`

**Interfaces:**
- Consumes: `PaydayHit` from Task 1.
- Produces:
  - Types: `ForecastModel`, `FactorStat`, `WeekdayStat`, `AccSums`, `DayContext = { date: string; dow: number; holiday: { name: string; liftPct: number | null } | null; rain: boolean; payday: PaydayHit | null }`, `ModelDayForecast = { sales: number; confidence: "high" | "medium" | "low"; drivers: string[] }`
  - `MODEL_VERSION = 1`
  - `emptyModel(storeId: string): ForecastModel`
  - `learnDay(model: ForecastModel, ctx: DayContext, actual: number): ForecastModel`
  - `forecastDay(model: ForecastModel, ctx: DayContext): ModelDayForecast | null`
  - `rainLiftPct(model): number`
  - `paydayLiftPct(model, hit: PaydayHit): number`
  - `foldAccuracy(acc: AccSums, projected: number, actual: number): AccSums`
  - `wape(acc: AccSums): number | null`, `bias(acc: AccSums): number | null`
  - `symmetricAccuracy(projected: number, actual: number): number`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/forecast/model.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/forecast/model.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement**

```ts
// src/lib/forecast/model.ts
// Pure learned-forecast maths. No Firestore, no AI. See
// docs/superpowers/specs/2026-10-08-learned-forecast-model-design.md §3.
import { dowOf, type PaydayHit } from "@/lib/forecast/payday";

export const MODEL_VERSION = 1;
const BASE_ALPHA = 0.25;
const MAD_ALPHA = 0.25;
const FACTOR_ALPHA = 0.2;
const SHRINK_K = 3;
const MAX_EVIDENCE = 10;
const ACC_DECAY = 1 / 28;
const CLIP_LO = 0.5;
const CLIP_HI = 2;
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OFFSET_LABEL: Record<string, string> = { "-1": "day before", "0": "payday itself", "1": "day after", "2": "2 days after" };

export type Evidence = { date: string; expected: number; actual: number; note?: string };
export type FactorStat = { liftPct: number; rawLogLift: number; samples: number; evidence: Evidence[] };
export type WeekdayStat = { base: number; mad: number; samples: number };
export type AccSums = { absErr: number; actual: number; signedErr: number; n: number };
export type ForecastModel = {
  version: number;
  storeId: string;
  processedThrough: string; // "" until the first day is learned
  updatedAtMs: number;
  weekday: Record<string, WeekdayStat>; // "0".."6"
  rain: FactorStat;
  payday: Record<string, FactorStat>; // "0_fri", "0_wkday", "0_all", ...
  accuracy: { model: AccSums; llm: AccSums };
  reasoning: { summary: string; flags: string[]; generatedAt: number; provider: "claude" | "gemini" } | null;
};
export type DayContext = {
  date: string;
  dow: number;
  holiday: { name: string; liftPct: number | null } | null; // liftPct null = no measured history
  rain: boolean;
  payday: PaydayHit | null;
};
export type ModelDayForecast = { sales: number; confidence: "high" | "medium" | "low"; drivers: string[] };

const emptyFactor = (): FactorStat => ({ liftPct: 0, rawLogLift: 0, samples: 0, evidence: [] });
const emptyAcc = (): AccSums => ({ absErr: 0, actual: 0, signedErr: 0, n: 0 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function emptyModel(storeId: string): ForecastModel {
  const weekday: Record<string, WeekdayStat> = {};
  for (let d = 0; d < 7; d++) weekday[String(d)] = { base: 0, mad: 0, samples: 0 };
  return {
    version: MODEL_VERSION, storeId, processedThrough: "", updatedAtMs: 0, weekday,
    rain: emptyFactor(), payday: {}, accuracy: { model: emptyAcc(), llm: emptyAcc() }, reasoning: null,
  };
}

/** Raw lift in %, shrunk toward 0 by samples/(samples+K). */
function shrunkPct(f: FactorStat | undefined): number {
  if (!f || f.samples === 0) return 0;
  return (Math.exp(f.rawLogLift) - 1) * 100 * (f.samples / (f.samples + SHRINK_K));
}

export function rainLiftPct(m: ForecastModel): number {
  return shrunkPct(m.rain);
}

const cellKey = (h: PaydayHit) => `${h.offset}_${h.cls}`;
const poolKey = (h: PaydayHit) => `${h.offset}_all`;

/** Cell estimate shrunk toward its offset's pooled estimate (itself shrunk toward 0). */
export function paydayLiftPct(m: ForecastModel, hit: PaydayHit): number {
  const pooled = shrunkPct(m.payday[poolKey(hit)]);
  const cell = m.payday[cellKey(hit)];
  const n = cell?.samples ?? 0;
  const cellRaw = n > 0 ? (Math.exp(cell!.rawLogLift) - 1) * 100 : 0;
  return (n * cellRaw + SHRINK_K * pooled) / (n + SHRINK_K);
}

function updateFactor(f: FactorStat, actual: number, expectedWithout: number, date: string, note?: string): void {
  const obs = Math.log(clamp(actual / expectedWithout, CLIP_LO, CLIP_HI));
  f.rawLogLift = f.samples === 0 ? obs : f.rawLogLift + FACTOR_ALPHA * (obs - f.rawLogLift);
  f.samples += 1;
  const row: Evidence = { date, expected: Math.round(expectedWithout), actual: Math.round(actual) };
  if (note) row.note = note;
  f.evidence = [...f.evidence, row].slice(-MAX_EVIDENCE);
}

function refreshLifts(m: ForecastModel): void {
  m.rain.liftPct = round1(rainLiftPct(m));
  for (const key of Object.keys(m.payday)) {
    const [off, cls] = key.split("_");
    m.payday[key].liftPct = round1(
      cls === "all"
        ? shrunkPct(m.payday[key])
        : paydayLiftPct(m, { offset: Number(off) as PaydayHit["offset"], cls: cls as PaydayHit["cls"], shiftedFrom: null, payday: "" }),
    );
  }
}

/** Learn one day. Pure: returns a new model (or the same object when the day was already learned). */
export function learnDay(prev: ForecastModel, ctx: DayContext, actual: number): ForecastModel {
  if (prev.processedThrough && ctx.date <= prev.processedThrough) return prev;
  const m: ForecastModel = structuredClone(prev);
  m.processedThrough = ctx.date;
  if (!(actual > 0)) return m;

  const w = m.weekday[String(ctx.dow)];
  if (w.samples === 0) {
    if (!ctx.holiday) Object.assign(w, { base: actual, mad: 0.2, samples: 1 });
    return m;
  }
  if (ctx.holiday) return m; // holiday lifts are owned by holidayEffects

  const rainM = ctx.rain ? 1 + rainLiftPct(m) / 100 : 1;
  const payM = ctx.payday ? 1 + paydayLiftPct(m, ctx.payday) / 100 : 1;
  const expected = w.base * rainM * payM;

  w.mad += MAD_ALPHA * (Math.abs(actual / expected - 1) - w.mad);
  if (ctx.rain) updateFactor(m.rain, actual, expected / rainM, ctx.date);
  if (ctx.payday) {
    const sf = ctx.payday.shiftedFrom;
    const note = sf ? `shifted from ${DOW_SHORT[dowOf(sf)]} ${sf}` : undefined;
    for (const key of [cellKey(ctx.payday), poolKey(ctx.payday)]) {
      m.payday[key] ??= emptyFactor();
      updateFactor(m.payday[key], actual, expected / payM, ctx.date, note);
    }
  }
  const defactored = clamp(actual / (rainM * payM), w.base * CLIP_LO, w.base * CLIP_HI);
  w.base += BASE_ALPHA * (defactored - w.base);
  w.samples += 1;
  refreshLifts(m);
  return m;
}

const peso = (v: number) => `₱${Math.round(v).toLocaleString("en-PH")}`;
const pct = (p: number) => `${p >= 0 ? "+" : "−"}${Math.round(Math.abs(p))}%`;
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function forecastDay(m: ForecastModel, ctx: DayContext): ModelDayForecast | null {
  const w = m.weekday[String(ctx.dow)];
  if (!w || w.samples === 0) return null;
  let v = w.base;
  let thin = false;
  const drivers = [`${DOW_SHORT[ctx.dow]} baseline ${peso(w.base)}`];

  if (ctx.payday) {
    const p = paydayLiftPct(m, ctx.payday);
    const n = m.payday[cellKey(ctx.payday)]?.samples ?? 0;
    if (n < 3) thin = true;
    v *= 1 + p / 100;
    drivers.push(`payday ${pct(p)} (${ctx.payday.cls === "fri" ? "Fri" : "midweek"} payday, ${OFFSET_LABEL[String(ctx.payday.offset)]}, ${days(n)})`);
  }
  if (ctx.rain) {
    const p = rainLiftPct(m);
    if (m.rain.samples < 3) thin = true;
    v *= 1 + p / 100;
    drivers.push(`PM rain ${pct(p)} (${days(m.rain.samples)})`);
  }
  if (ctx.holiday) {
    if (ctx.holiday.liftPct != null) {
      v *= 1 + ctx.holiday.liftPct / 100;
      drivers.push(`${ctx.holiday.name} ${pct(ctx.holiday.liftPct)}`);
    } else {
      thin = true;
      drivers.push(`${ctx.holiday.name} — no history yet`);
    }
  }
  let level = w.mad < 0.12 ? 0 : w.mad < 0.25 ? 1 : 2;
  if (thin) level = Math.min(2, level + 1);
  return { sales: Math.round(v), confidence: (["high", "medium", "low"] as const)[level], drivers };
}

export function foldAccuracy(acc: AccSums, projected: number, actual: number): AccSums {
  const d = 1 - ACC_DECAY;
  return {
    absErr: acc.absErr * d + Math.abs(projected - actual),
    actual: acc.actual * d + actual,
    signedErr: acc.signedErr * d + (projected - actual),
    n: acc.n + 1,
  };
}
export const wape = (a: AccSums): number | null => (a.actual > 0 ? a.absErr / a.actual : null);
export const bias = (a: AccSums): number | null => (a.actual > 0 ? a.signedErr / a.actual : null);

/** Same formula the accuracy backfill always used: 1 − |err| / max(actual, projected), in [0,1]. */
export function symmetricAccuracy(projected: number, actual: number): number {
  const denom = Math.max(actual, projected);
  return denom > 0 ? clamp(1 - Math.abs(actual - projected) / denom, 0, 1) : 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/forecast/model.test.ts`
Expected: all PASS. If the payday driver test shows `+27%`, that is `round(26.67)`, which is correct.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forecast/model.ts src/lib/forecast/model.test.ts
git commit -m "feat(forecast): pure learned model — weekday baselines, rain and payday factors, drivers"
```

---

### Task 3: Day context and learn schedule (pure)

**Files:**
- Create: `src/lib/forecast/context.ts`
- Test: `src/lib/forecast/context.test.ts`

**Interfaces:**
- Consumes: `addDaysYmd`, `dowOf`, `paydayHitFor`, `EffectivePayday` (Task 1); `DayContext` (Task 2); `slugifyHoliday` from `@/lib/holidays/holiday-calendar`; `HolidayEffect` from `@/lib/holidays/holiday-effects`.
- Produces:
  - `toDayId(ymd: string): string`
  - `LoggedWeatherDay = { condition?: string; am?: string; pm?: string; pop?: number | null }`
  - `ContextSources = { calendarNames: Record<string, string>; holidayOverrides: Record<string, string>; staffPaydays: Set<string>; effects: Record<string, HolidayEffect>; paydays: EffectivePayday[]; weather: Record<string, LoggedWeatherDay> }` (all keyed by dayId)
  - `buildDayContext(date: string, src: ContextSources, mode: "learn" | "forecast"): DayContext`
  - `daysToLearn(processedThrough: string | null, today: string, hasSales: (ymd: string) => boolean, bootstrapDays?: number): string[]`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/forecast/context.test.ts
import { describe, it, expect } from "vitest";
import { buildDayContext, daysToLearn, type ContextSources } from "@/lib/forecast/context";
import { effectivePaydays } from "@/lib/forecast/payday";

const base = (over: Partial<ContextSources> = {}): ContextSources => ({
  calendarNames: {}, holidayOverrides: {}, staffPaydays: new Set(), effects: {},
  paydays: effectivePaydays([10, 31], "2026-10-01", "2026-10-31"), weather: {}, ...over,
});

describe("buildDayContext", () => {
  it("looks up a calendar holiday's measured lift by slug", () => {
    const src = base({
      calendarNames: { "20261225": "Christmas Day" },
      effects: { "christmas-day": { name: "Christmas Day", slug: "christmas-day", avgLiftPct: 34, samples: 2, lastDate: "2025-12-25", occurrences: [] } },
    });
    expect(buildDayContext("2026-12-25", src, "forecast").holiday).toEqual({ name: "Christmas Day", liftPct: 34 });
  });
  it("an override of 'None' clears a calendar holiday", () => {
    const src = base({ calendarNames: { "20261225": "Christmas Day" }, holidayOverrides: { "20261225": "None" } });
    expect(buildDayContext("2026-12-25", src, "learn").holiday).toBeNull();
  });
  it("a holiday with no measured history has liftPct null", () => {
    expect(buildDayContext("2026-10-20", base({ calendarNames: { "20261020": "Fiesta" } }), "forecast").holiday)
      .toEqual({ name: "Fiesta", liftPct: null });
  });
  it("learn mode counts any logged PM rain; forecast mode needs a high chance or heavy rain", () => {
    const light = base({ weather: { "20261020": { pm: "light_rain", pop: 0.3 } } });
    expect(buildDayContext("2026-10-20", light, "learn").rain).toBe(true);
    expect(buildDayContext("2026-10-20", light, "forecast").rain).toBe(false);
    expect(buildDayContext("2026-10-20", base({ weather: { "20261020": { pm: "light_rain", pop: 0.7 } } }), "forecast").rain).toBe(true);
    expect(buildDayContext("2026-10-20", base({ weather: { "20261020": { pm: "heavy_rain", pop: 0.2 } } }), "forecast").rain).toBe(true);
    expect(buildDayContext("2026-10-20", base(), "learn").rain).toBe(false); // no weather logged
  });
  it("attaches the payday hit and weekday", () => {
    const c = buildDayContext("2026-10-09", base(), "forecast");
    expect(c.dow).toBe(5);
    expect(c.payday).toMatchObject({ offset: 0, cls: "fri", shiftedFrom: "2026-10-10" });
  });
  it("uses a staff-confirmed payday", () => {
    expect(buildDayContext("2026-10-20", base({ staffPaydays: new Set(["20261020"]) }), "learn").payday?.offset).toBe(0);
  });
});

describe("daysToLearn", () => {
  const today = "2026-10-08";
  it("returns every day after processedThrough up to yesterday", () => {
    expect(daysToLearn("2026-10-05", today, () => true)).toEqual(["2026-10-06", "2026-10-07"]);
  });
  it("stops at a missing day within the last 2 days (not synced yet) so it retries tomorrow", () => {
    const has = (d: string) => d !== "2026-10-07";
    expect(daysToLearn("2026-10-05", today, has)).toEqual(["2026-10-06"]);
  });
  it("keeps older missing days (closed) so learning moves on", () => {
    const has = (d: string) => d !== "2026-10-02";
    expect(daysToLearn("2026-09-30", today, has)).toContain("2026-10-02");
  });
  it("bootstraps from today − 90 when nothing has been learned", () => {
    const ds = daysToLearn(null, today, () => true);
    expect(ds[0]).toBe("2026-07-10");
    expect(ds.at(-1)).toBe("2026-10-07");
    expect(ds).toHaveLength(90);
  });
  it("returns nothing when already up to date", () => {
    expect(daysToLearn("2026-10-07", today, () => true)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/forecast/context.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement**

```ts
// src/lib/forecast/context.ts
// Pure: turns raw per-store docs into the DayContext the model consumes.
import { slugifyHoliday } from "@/lib/holidays/holiday-calendar";
import type { HolidayEffect } from "@/lib/holidays/holiday-effects";
import type { DayContext } from "@/lib/forecast/model";
import { addDaysYmd, dowOf, paydayHitFor, type EffectivePayday } from "@/lib/forecast/payday";

export type LoggedWeatherDay = { condition?: string; am?: string; pm?: string; pop?: number | null };
export type ContextSources = {
  calendarNames: Record<string, string>;      // dayId -> holiday name (AI calendar)
  holidayOverrides: Record<string, string>;   // dayId -> name from dailyContext ("None" clears)
  staffPaydays: Set<string>;                  // dayIds with dailyContext.isPayday.value === true
  effects: Record<string, HolidayEffect>;     // holidayEffects/summary.effects, keyed by slug
  paydays: EffectivePayday[];
  weather: Record<string, LoggedWeatherDay>;  // weatherForecasts month docs' `days`, keyed by dayId
};

const RAIN = /rain|storm|thunder/i;
const HEAVY = /heavy|storm|thunder/i;

export const toDayId = (ymd: string) => ymd.replace(/-/g, "");

function pmText(w: LoggedWeatherDay): string {
  return String(w.pm ?? w.condition ?? "");
}

export function buildDayContext(date: string, src: ContextSources, mode: "learn" | "forecast"): DayContext {
  const id = toDayId(date);
  const ov = src.holidayOverrides[id];
  const name = ov !== undefined ? (ov && ov !== "None" ? ov : null) : (src.calendarNames[id] ?? null);
  const eff = name ? src.effects[slugifyHoliday(name)] : undefined;
  const w = src.weather[id];
  let rain = false;
  if (w && RAIN.test(pmText(w))) {
    rain = mode === "learn" || HEAVY.test(pmText(w)) || (w.pop ?? 0) >= 0.6;
  }
  return {
    date,
    dow: dowOf(date),
    holiday: name ? { name, liftPct: eff && eff.samples >= 1 ? eff.avgLiftPct : null } : null,
    rain,
    payday: paydayHitFor(date, src.paydays, src.staffPaydays.has(id)),
  };
}

/**
 * Dates the nightly learner should process, oldest first. Stops at the first
 * day with no analytics doc inside the last 2 days (probably not synced yet,
 * retried next night); older missing days are kept (closed → learned as 0).
 */
export function daysToLearn(
  processedThrough: string | null,
  today: string,
  hasSales: (ymd: string) => boolean,
  bootstrapDays = 90,
): string[] {
  const yesterday = addDaysYmd(today, -1);
  const recentCutoff = addDaysYmd(today, -2);
  const out: string[] = [];
  for (let d = processedThrough ? addDaysYmd(processedThrough, 1) : addDaysYmd(today, -bootstrapDays); d <= yesterday; d = addDaysYmd(d, 1)) {
    if (!hasSales(d) && d >= recentCutoff) break;
    out.push(d);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/forecast/context.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forecast/context.ts src/lib/forecast/context.test.ts
git commit -m "feat(forecast): day context builder and learn schedule"
```

---

### Task 4: Acceptance replay (read-only) — the gate

**Files:**
- Create: `scripts/forecast-model-replay.ts`

**Interfaces:**
- Consumes: `emptyModel`, `learnDay`, `forecastDay` (Task 2); `buildDayContext`, `toDayId`, `ContextSources` (Task 3); `effectivePaydays`, `paydayDaysOfMonth`, `addDaysYmd` (Task 1).

This replays the whole history: forecast each day **before** learning it, then compare against the stored LLM projection and the 4-week same-weekday average on the same days. It is read-only.

- [ ] **Step 1: Write the script**

```ts
// scripts/forecast-model-replay.ts
// READ-ONLY. Usage: node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/forecast-model-replay.ts
// Note: holidayEffects lifts were computed from all history, so holiday days carry slight lookahead.
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { emptyModel, forecastDay, learnDay } from "@/lib/forecast/model";
import { buildDayContext, toDayId, type ContextSources } from "@/lib/forecast/context";
import { addDaysYmd, effectivePaydays, paydayDaysOfMonth } from "@/lib/forecast/payday";
import type { ForecastConfig } from "@/lib/types";

const sa = JSON.parse(readFileSync(process.env.FIREBASE_ADMIN_SA_PATH!, "utf8"));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: String(sa.private_key).replace(/\\n/g, "\n") }) });
const db = getFirestore();
const ymd = (id: string) => `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
type Sums = { abs: number; act: number; sig: number; n: number };
const z = (): Sums => ({ abs: 0, act: 0, sig: 0, n: 0 });
const add = (s: Sums, p: number, a: number) => { s.abs += Math.abs(p - a); s.act += a; s.sig += p - a; s.n++; };
const fmt = (s: Sums) => s.act ? `${(100 * s.abs / s.act).toFixed(1)}% (bias ${(100 * s.sig / s.act).toFixed(1)}%)` : "n/a";

(async () => {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const all = { model: z(), llm: z(), avg4: z() };
  for (const store of (await db.collection("stores").get()).docs) {
    const sid = store.id;
    const [an, fc, cal, wf, dc, eff] = await Promise.all([
      db.collection(`stores/${sid}/analytics`).get(),
      db.collection(`stores/${sid}/salesForecasts`).get(),
      db.collection(`stores/${sid}/holidayCalendar`).get(),
      db.collection(`stores/${sid}/weatherForecasts`).get(),
      db.collection(`stores/${sid}/dailyContext`).get(),
      db.doc(`stores/${sid}/holidayEffects/summary`).get(),
    ]);
    if (fc.empty || an.empty) continue;
    const sales = new Map<string, number>();
    an.docs.forEach((d) => { if (/^\d{8}$/.test(d.id)) sales.set(ymd(d.id), d.data()?.payments?.totalGross ?? 0); });
    const llm = new Map<string, number>();
    fc.docs.forEach((d) => {
      const x = d.data();
      const v = typeof x.llmSales === "number" ? x.llmSales : x.engine === "model" ? null : x.projectedSales;
      if (typeof v === "number") llm.set(x.date ?? d.id, v);
    });
    const dates = [...sales.keys()].sort();
    const first = dates[0];
    const src: ContextSources = {
      calendarNames: {}, holidayOverrides: {}, staffPaydays: new Set(),
      effects: (eff.data()?.effects ?? {}) as ContextSources["effects"], paydays: [], weather: {},
    };
    cal.docs.forEach((d) => Object.entries((d.data()?.days ?? {}) as Record<string, { name: string }>).forEach(([id, e]) => (src.calendarNames[id] = e.name)));
    wf.docs.forEach((d) => Object.assign(src.weather, d.data()?.days ?? {}));
    dc.docs.forEach((d) => {
      const x = d.data(); const id = x.dayId ?? d.id;
      if (typeof x.holiday?.name === "string") src.holidayOverrides[id] = x.holiday.name;
      if (x.isPayday?.value === true) src.staffPaydays.add(id);
    });
    const dom = paydayDaysOfMonth(store.data().forecastConfig as ForecastConfig | undefined);
    src.paydays = dom ? effectivePaydays(dom, first, today) : [];

    let model = emptyModel(sid);
    const st = { model: z(), llm: z(), avg4: z() };
    for (let d = first; d < today; d = addDaysYmd(d, 1)) {
      const actual = sales.get(d) ?? 0;
      const f = forecastDay(model, buildDayContext(d, src, "forecast"));
      const prior = [7, 14, 21, 28].map((k) => sales.get(addDaysYmd(d, -k)) ?? 0).filter((v) => v > 0);
      const p = llm.get(d);
      if (f && actual > 0 && typeof p === "number" && prior.length === 4) {
        const avg4 = prior.reduce((a, b) => a + b, 0) / 4;
        for (const [k, v] of [["model", f.sales], ["llm", p], ["avg4", avg4]] as const) { add(st[k], v, actual); add(all[k], v, actual); }
      }
      model = learnDay(model, buildDayContext(d, src, "learn"), actual);
    }
    if (st.model.n) console.log(`${store.data().name ?? sid} n=${st.model.n} | model ${fmt(st.model)} | llm ${fmt(st.llm)} | avg4 ${fmt(st.avg4)}`);
  }
  console.log(`ALL n=${all.model.n} | model ${fmt(all.model)} | llm ${fmt(all.llm)} | avg4 ${fmt(all.avg4)}`);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it (read-only)**

Run: `node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/forecast-model-replay.ts`
Expected: one line per store plus `ALL`. Baseline from 2026-10-08: llm 33.5%, avg4 28.8% WAPE over about 445 days.

- [ ] **Step 3: Gate**

- If the `ALL` model WAPE ≤ the LLM WAPE, continue to Task 5.
- If it is worse, **stop and report the numbers to Ian**. Do not tune constants silently. Any tuning is a decision for Ian.

- [ ] **Step 4: Commit**

```bash
git add scripts/forecast-model-replay.ts
git commit -m "chore(forecast): read-only replay comparing learned model vs LLM vs 4-wk avg"
```

---

### Task 5: Types, Manila-safe payroll dates, config builder

**Files:**
- Modify: `src/lib/types.ts`: `ForecastConfig` (around line 1011) and `SalesForecast` (around line 1801)
- Modify: `src/lib/utils/forecast-helpers.ts`: `getUpcomingPayrollDates` (lines 41–85), add `buildForecastConfig`
- Test: `src/lib/utils/forecast-helpers.test.ts` (create)

**Interfaces:**
- Consumes: `effectivePaydays`, `paydayDaysOfMonth`, `addDaysYmd` (Task 1); `manilaDayAnchor`, `anchorYmd`.
- Produces:
  - `ForecastConfig.engine?: "llm" | "model"`
  - `SalesForecast` gains `modelSales?`, `llmSales?`, `modelConfidence?`, `drivers?`, `modelAccuracy?`, `engine?`, `provider?`
  - `getUpcomingPayrollDates(config?: ForecastConfig, nowMs?: number): string[]`
  - `buildForecastConfig(input: { holidays: { name: string; date: string }[]; payrollDatesText: string; storeContext: string; engine: "llm" | "model" }): ForecastConfig`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/utils/forecast-helpers.test.ts
import { describe, it, expect } from "vitest";
import { buildForecastConfig, getUpcomingPayrollDates } from "@/lib/utils/forecast-helpers";

describe("getUpcomingPayrollDates", () => {
  // 2026-10-08 05:00 Manila = 2026-10-07T21:00Z (the cron's real firing time)
  const now = Date.parse("2026-10-07T21:00:00Z");
  it("uses the Manila date, clamps 31 to EOM, and shifts weekends to Friday", () => {
    const ds = getUpcomingPayrollDates({ payrollScheduleType: "custom", customPayrollDates: [10, 31] }, now);
    expect(ds.slice(0, 3)).toEqual(["2026-10-09", "2026-10-30", "2026-11-10"]);
  });
  it("never spills a 31st into the next month", () => {
    const ds = getUpcomingPayrollDates({ payrollScheduleType: "custom", customPayrollDates: [31] }, now);
    expect(ds).toContain("2026-11-30");
    expect(ds).not.toContain("2026-12-01");
  });
});

describe("buildForecastConfig", () => {
  it("keeps the engine and parses only valid day numbers", () => {
    expect(buildForecastConfig({ holidays: [], payrollDatesText: "10, 31, x, 0, 40", storeContext: "  near school ", engine: "model" }))
      .toEqual({ customHolidays: [], payrollScheduleType: "custom", customPayrollDates: [10, 31], storeContext: "near school", engine: "model" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/utils/forecast-helpers.test.ts`
Expected: FAIL. `buildForecastConfig` is not exported, and the payroll dates use local time.

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, change `ForecastConfig` to:

```ts
export type ForecastConfig = {
  customHolidays?: { name: string; date: string }[]; // date in YYYY-MM-DD
  payrollScheduleType?: 'semi_monthly_15_eom' | 'weekly' | 'bi_weekly' | 'custom';
  customPayrollDates?: number[]; // day-of-month numbers (1–31); 31 = end of month
  payrollWeekday?: number; // 0=Sun..6=Sat for weekly/bi-weekly
  storeContext?: string; // free-text AI context, e.g. "near a university"
  /** Which number becomes projectedSales. "llm" (default) keeps the learned model in shadow. */
  engine?: 'llm' | 'model';
};
```

and add to `SalesForecast`, after `confidence`:

```ts
  /** Learned-model projection (always written when the model exists). */
  modelSales?: number;
  modelConfidence?: 'high' | 'medium' | 'low';
  /** Why the model projected this number, e.g. "Sat baseline ₱48,200". */
  drivers?: string[];
  /** LLM projection, written only when the LLM ran (engine "llm"). */
  llmSales?: number;
  modelAccuracy?: number;
  engine?: 'llm' | 'model';
  provider?: 'claude' | 'gemini' | 'model';
```

In `src/lib/utils/forecast-helpers.ts`:
- Add the imports.
- Replace the `custom` and `semi_monthly_15_eom` branches of `getUpcomingPayrollDates`, and give it a `nowMs` parameter. Keep the weekly/bi-weekly branch as it is.
- Add `buildForecastConfig`.

```ts
import { addDaysYmd, effectivePaydays, paydayDaysOfMonth } from "@/lib/forecast/payday";
import { anchorYmd, manilaDayAnchor } from "@/lib/analytics/manila-day";

export function getUpcomingPayrollDates(config?: ForecastConfig, nowMs: number = Date.now()): string[] {
  const type = config?.payrollScheduleType ?? "semi_monthly_15_eom";
  if (type === "weekly" || type === "bi_weekly") {
    const today = atStartOfDay(new Date(nowMs));
    const dates: Date[] = [];
    const weekday = config?.payrollWeekday ?? 5; // default Friday
    const stepDays = type === "bi_weekly" ? 14 : 7;
    const d = new Date(today);
    while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
    for (let i = 0; i < 8; i++) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + stepDays);
    }
    return dates.map((date) => format(date, "yyyy-MM-dd"));
  }
  // Day-of-month schedules: Manila calendar maths on strings (no server-local
  // Date getters), 31 clamps to month end, Sat/Sun pay moves to Friday.
  const dom = paydayDaysOfMonth(config) ?? [15, 31];
  const today = anchorYmd(manilaDayAnchor(nowMs));
  return effectivePaydays(dom, today, addDaysYmd(today, 75))
    .map((p) => p.date)
    .filter((d) => d >= today);
}

export function buildForecastConfig(input: {
  holidays: { name: string; date: string }[];
  payrollDatesText: string;
  storeContext: string;
  engine: "llm" | "model";
}): ForecastConfig {
  const customPayrollDates = input.payrollDatesText
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n >= 1 && n <= 31);
  return {
    customHolidays: input.holidays,
    payrollScheduleType: "custom",
    customPayrollDates,
    storeContext: input.storeContext.trim().slice(0, 500),
    engine: input.engine,
  };
}
```

`adjustWeekend` is no longer used. Delete it if `npx tsc --noEmit` reports it unused; keep `atStartOfDay`, which the weekly branch and `getUpcomingHolidays` still use.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/lib/utils/forecast-helpers.test.ts && npx tsc --noEmit -p .`
Expected: tests PASS, and no new type errors. If any `SalesForecast` consumer breaks, the new fields are all optional, so look for a typo.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/utils/forecast-helpers.ts src/lib/utils/forecast-helpers.test.ts
git commit -m "feat(forecast): engine config, model fields on forecasts, Manila-safe payroll dates with EOM clamp"
```

---

### Task 6: AI — provider attribution and weekly model explanation

**Files:**
- Modify: `src/ai/claude.ts` (add `explainWithClaude`)
- Modify: `src/ai/flows/forecast-weekly-sales.ts`: move the Claude→Gemini choice from the flow body into `forecastWeeklySales` and return `provider`
- Create: `src/ai/flows/explain-forecast-model.ts`

**Interfaces:**
- Consumes: `ForecastModel` (Task 2).
- Produces:
  - `forecastWeeklySales(input: ForecastInput): Promise<ForecastOutput & { provider: "claude" | "gemini" }>`
  - `explainForecastModel(model: ForecastModel): Promise<{ summary: string; flags: string[]; provider: "claude" | "gemini" }>`
  - `buildExplainPrompt(model: ForecastModel): string`

- [ ] **Step 1: Add `explainWithClaude` to `src/ai/claude.ts`** (append at the end of the file)

```ts
const ExplanationSchema = z.object({
  summary: z.string(),
  flags: z.array(z.string()).max(5),
});
export type ClaudeExplanation = z.infer<typeof ExplanationSchema>;

/** Weekly plain-language review of a learned forecast model. Throws on any failure so the caller can fall back. */
export async function explainWithClaude(promptText: string): Promise<ClaudeExplanation> {
  const response = await getClient().messages.parse({
    model: CLAUDE_FORECAST_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(ExplanationSchema) },
    messages: [{ role: "user", content: promptText }],
  });
  if (response.stop_reason === "refusal") throw new Error(`Claude refused: ${response.stop_details?.category ?? "unknown"}`);
  if (response.stop_reason === "max_tokens") throw new Error("Claude hit max_tokens");
  if (!response.parsed_output) throw new Error("Claude returned no parseable explanation");
  return response.parsed_output;
}
```

- [ ] **Step 2: Return the provider from `forecastWeeklySales`**

In `src/ai/flows/forecast-weekly-sales.ts`, replace the exported function and the flow body:

```ts
export async function forecastWeeklySales(input: ForecastInput): Promise<ForecastOutput & { provider: "claude" | "gemini" }> {
  // Claude first; any failure (no key, API error, refusal, bad JSON) falls through to Gemini.
  if (isClaudeConfigured()) {
    try {
      const rendered = await prompt.render(input);
      const promptText = (rendered.messages ?? [])
        .flatMap(m => m.content.map(p => p.text ?? ''))
        .join('\n')
        .trim();
      if (promptText) return { ...(await forecastWithClaude(promptText)), provider: "claude" };
    } catch (e) {
      console.warn("[forecastWeeklySales] Claude failed, falling back to Gemini:", e);
    }
  }
  return { ...(await forecastWeeklySalesFlow(input)), provider: "gemini" };
}
```

The flow body goes back to Gemini only:

```ts
  async input => {
    try {
      const { output } = await prompt(input);
      if (!output) throw new Error("Forecast prompt returned no output");
      return output;
    } catch (e) {
      console.error("[forecastWeeklySalesFlow] failed:", e);
      throw e; // keep throwing so route error boundary/logs catch it
    }
  }
```

Function declarations are hoisted, but `const prompt` and `const forecastWeeklySalesFlow` are not. That is fine, because `forecastWeeklySales` only runs after module load.

- [ ] **Step 3: Create the explanation flow**

```ts
// src/ai/flows/explain-forecast-model.ts
import "server-only";
import { ai } from "@/ai/genkit";
import { z } from "genkit";
import { explainWithClaude, isClaudeConfigured } from "@/ai/claude";
import type { ForecastModel } from "@/lib/forecast/model";

const ExplanationSchema = z.object({ summary: z.string(), flags: z.array(z.string()) });
export type ModelExplanation = { summary: string; flags: string[]; provider: "claude" | "gemini" };

export function buildExplainPrompt(model: ForecastModel): string {
  const { reasoning: _previous, ...facts } = model;
  return `You review the learned sales-forecast model of one restaurant branch in the Philippines. Amounts are pesos (₱).

Fields:
- weekday["0".."6"] (Sun..Sat): base = typical sales, mad = typical miss ratio (stability), samples = days learned.
- rain: effect of afternoon/evening rain. liftPct = applied effect in %, samples = rainy days learned, evidence = recent days (expected vs actual).
- payday["<offset>_<class>"]: offset -1 = day before payday, 0 = payday, 1/2 = days after; class "fri" = payday fell on a Friday (natural, or moved from a weekend — see evidence notes "shifted from Sat ..."), "wkday" = Mon–Thu payday, "all" = both pooled.
- accuracy.model / accuracy.llm: decayed sums; WAPE = absErr/actual, bias = signedErr/actual.

Write:
1. summary: at most 120 words, plain language for a store manager — what drives this branch's sales, using only numbers present in the JSON.
2. flags: at most 5 short observations worth acting on, e.g. a factor based on fewer than 3 days, an unstable weekday (mad above 0.25), whether Friday paydays lift more than midweek ones, whether shifted Friday paydays differ from natural ones, a factor whose recent evidence disagrees with its liftPct, the model beating or trailing the AI forecast.

Never invent numbers. If data is too thin to say something, say so.

MODEL JSON:
${JSON.stringify(facts)}`;
}

export async function explainForecastModel(model: ForecastModel): Promise<ModelExplanation> {
  const promptText = buildExplainPrompt(model);
  if (isClaudeConfigured()) {
    try {
      const r = await explainWithClaude(promptText);
      return { summary: r.summary.slice(0, 1200), flags: r.flags.slice(0, 5), provider: "claude" };
    } catch (e) {
      console.warn("[explainForecastModel] Claude failed, falling back to Gemini:", e);
    }
  }
  const { output } = await ai.generate({ prompt: promptText, output: { schema: ExplanationSchema } });
  if (!output) throw new Error("Gemini returned no explanation");
  return { summary: output.summary.slice(0, 1200), flags: output.flags.slice(0, 5), provider: "gemini" };
}
```

- [ ] **Step 4: Typecheck and live-smoke the explainer (read-only, no Firestore)**

Run: `npx tsc --noEmit -p .`
Expected: no errors in `src/ai/`.

Then smoke-test with a throwaway script. Use the `server-only` stub from vitest's alias: `src/__mocks__/server-only.ts` exists. Map it with NODE_PATH:

```bash
mkdir -p "$TEMP/so/node_modules/server-only" && echo '{"name":"server-only","main":"index.js"}' > "$TEMP/so/node_modules/server-only/package.json" && echo "" > "$TEMP/so/node_modules/server-only/index.js"
cat > scripts/_smoke-explain.ts <<'EOF'
import { emptyModel } from "@/lib/forecast/model";
import { explainForecastModel } from "@/ai/flows/explain-forecast-model";
const m = emptyModel("smoke"); m.weekday["5"] = { base: 40000, mad: 0.15, samples: 12 };
m.payday["0_fri"] = { liftPct: 18, rawLogLift: Math.log(1.24), samples: 4, evidence: [] };
explainForecastModel(m).then((r) => console.log(JSON.stringify(r, null, 2)));
EOF
NODE_PATH="$TEMP/so/node_modules" node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/_smoke-explain.ts; rm scripts/_smoke-explain.ts
```

Expected: JSON with `provider: "claude"`, a summary of at most 120 words, and at most 5 flags.

- [ ] **Step 5: Commit**

```bash
git add src/ai/claude.ts src/ai/flows/forecast-weekly-sales.ts src/ai/flows/explain-forecast-model.ts
git commit -m "feat(ai): record forecast provider; weekly Claude review of learned model with Gemini fallback"
```

---

### Task 7: Server I/O — learner in the accuracy cron

**Files:**
- Create: `src/lib/server/forecast-model.ts`
- Modify: `src/lib/server/generate-forecast.ts`: replace the body of `updateAccuracyForAllActiveStores`, and delete `backfillRecentAccuracy` and its call at the top of `generateForecastForStore` (step "1. Backfill accuracy")

**Interfaces:**
- Consumes: Tasks 1–3 and 6 (`explainForecastModel`), `getAdminDb`, `manilaDayAnchor`/`anchorYmd`, `dayIdToDate` from `@/lib/holidays/holiday-calendar`.
- Produces:
  - `loadForecastModel(storeId: string): Promise<ForecastModel | null>`
  - `loadContextSources(storeId: string, config: ForecastConfig | undefined, fromYmd: string, toYmd: string): Promise<ContextSources>`
  - `learnForecastModel(storeId: string, config: ForecastConfig | undefined, opts: { aiEnabled: boolean; nowMs?: number }): Promise<{ learnedDays: number; bootstrapped: boolean; reasoned: boolean }>`
  - `forecastNext7(storeId: string, config: ForecastConfig | undefined, todayYmd: string, model: ForecastModel): Promise<({ date: string } & ModelDayForecast)[]>`

- [ ] **Step 1: Create the server module**

```ts
// src/lib/server/forecast-model.ts
import "server-only";

import { FieldPath } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { anchorYmd, manilaDayAnchor } from "@/lib/analytics/manila-day";
import { dayIdToDate } from "@/lib/holidays/holiday-calendar";
import { explainForecastModel } from "@/ai/flows/explain-forecast-model";
import {
  emptyModel, foldAccuracy, forecastDay, learnDay, symmetricAccuracy, MODEL_VERSION,
  type ForecastModel, type ModelDayForecast,
} from "@/lib/forecast/model";
import { buildDayContext, daysToLearn, toDayId, type ContextSources } from "@/lib/forecast/context";
import { addDaysYmd, dowOf, effectivePaydays, paydayDaysOfMonth } from "@/lib/forecast/payday";
import type { ForecastConfig, SalesForecast } from "@/lib/types";

const BOOTSTRAP_DAYS = 90;
const REASONING_MAX_AGE_MS = 6 * 86_400_000;

const modelDoc = (storeId: string) => getAdminDb().doc(`stores/${storeId}/forecastModel/current`);

export async function loadForecastModel(storeId: string): Promise<ForecastModel | null> {
  const snap = await modelDoc(storeId).get();
  const m = snap.exists ? (snap.data() as ForecastModel) : null;
  return m && m.version === MODEL_VERSION ? m : null;
}

function monthIds(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  for (let d = `${fromYmd.slice(0, 7)}-01`; d.slice(0, 7) <= toYmd.slice(0, 7); d = addDaysYmd(d, 32).slice(0, 8) + "01") {
    out.push(d.slice(0, 7));
  }
  return out;
}

export async function loadContextSources(
  storeId: string, config: ForecastConfig | undefined, fromYmd: string, toYmd: string,
): Promise<ContextSources> {
  const db = getAdminDb();
  const years = [...new Set(monthIds(fromYmd, toYmd).map((m) => m.slice(0, 4)))];
  const [calSnaps, wfSnaps, dcSnap, effSnap] = await Promise.all([
    Promise.all(years.map((y) => db.doc(`stores/${storeId}/holidayCalendar/${y}`).get())),
    Promise.all(monthIds(fromYmd, toYmd).map((ym) => db.doc(`stores/${storeId}/weatherForecasts/${ym}`).get())),
    db.collection(`stores/${storeId}/dailyContext`)
      .where(FieldPath.documentId(), ">=", toDayId(fromYmd))
      .where(FieldPath.documentId(), "<=", toDayId(toYmd))
      .get(),
    db.doc(`stores/${storeId}/holidayEffects/summary`).get(),
  ]);
  const src: ContextSources = {
    calendarNames: {}, holidayOverrides: {}, staffPaydays: new Set(),
    effects: (effSnap.data()?.effects ?? {}) as ContextSources["effects"],
    paydays: [], weather: {},
  };
  for (const s of calSnaps) {
    for (const [id, e] of Object.entries((s.data()?.days ?? {}) as Record<string, { name: string }>)) src.calendarNames[id] = e.name;
  }
  for (const s of wfSnaps) Object.assign(src.weather, s.data()?.days ?? {});
  for (const d of dcSnap.docs) {
    const x = d.data();
    if (typeof x.holiday?.name === "string") src.holidayOverrides[d.id] = x.holiday.name;
    if (x.isPayday?.value === true) src.staffPaydays.add(d.id);
  }
  const dom = paydayDaysOfMonth(config);
  src.paydays = dom ? effectivePaydays(dom, fromYmd, toYmd) : [];
  return src;
}

/**
 * Nightly: learn every unprocessed day up to yesterday (bootstrap 90 days on
 * first run), write accuracy onto those days' forecast docs, and on Sundays
 * refresh the AI reasoning. Idempotent; a missed night is caught up next run.
 */
export async function learnForecastModel(
  storeId: string, config: ForecastConfig | undefined, opts: { aiEnabled: boolean; nowMs?: number },
): Promise<{ learnedDays: number; bootstrapped: boolean; reasoned: boolean }> {
  const db = getAdminDb();
  const nowMs = opts.nowMs ?? Date.now();
  const today = anchorYmd(manilaDayAnchor(nowMs));
  const yesterday = addDaysYmd(today, -1);
  const existing = await loadForecastModel(storeId);
  let model = existing ?? emptyModel(storeId);
  const start = model.processedThrough ? addDaysYmd(model.processedThrough, 1) : addDaysYmd(today, -BOOTSTRAP_DAYS);
  let learnedDays = 0;

  if (start <= yesterday) {
    const [anSnap, src] = await Promise.all([
      db.collection(`stores/${storeId}/analytics`)
        .where(FieldPath.documentId(), ">=", toDayId(start))
        .where(FieldPath.documentId(), "<=", toDayId(yesterday))
        .get(),
      loadContextSources(storeId, config, start, yesterday),
    ]);
    const sales = new Map<string, number>();
    for (const d of anSnap.docs) sales.set(dayIdToDate(d.id), d.data()?.payments?.totalGross ?? 0);

    const dates = daysToLearn(model.processedThrough || null, today, (d) => sales.has(d), BOOTSTRAP_DAYS);
    if (dates.length) {
      const fcSnaps = await db.getAll(...dates.map((d) => db.doc(`stores/${storeId}/salesForecasts/${d}`)));
      const batch = db.batch();
      let writes = 0;
      dates.forEach((date, i) => {
        const actual = sales.get(date) ?? 0;
        const snap = fcSnaps[i];
        if (snap.exists && actual > 0) {
          const fc = snap.data() as SalesForecast;
          const upd: Record<string, number> = {};
          if (fc.actualSales == null) upd.actualSales = actual;
          if (fc.accuracy == null && typeof fc.projectedSales === "number") upd.accuracy = symmetricAccuracy(fc.projectedSales, actual);
          if (fc.modelAccuracy == null && typeof fc.modelSales === "number") upd.modelAccuracy = symmetricAccuracy(fc.modelSales, actual);
          if (Object.keys(upd).length) { batch.update(snap.ref, upd); writes++; }
          // Like-for-like: fold only days where both engines projected.
          if (typeof fc.modelSales === "number" && typeof fc.llmSales === "number") {
            model = {
              ...model,
              accuracy: {
                model: foldAccuracy(model.accuracy.model, fc.modelSales, actual),
                llm: foldAccuracy(model.accuracy.llm, fc.llmSales, actual),
              },
            };
          }
        }
        model = learnDay(model, buildDayContext(date, src, "learn"), actual);
        learnedDays++;
      });
      if (writes) await batch.commit();
    }
  }

  let reasoned = false;
  const stale = !model.reasoning || nowMs - model.reasoning.generatedAt > REASONING_MAX_AGE_MS;
  const hasData = Object.values(model.weekday).some((w) => w.samples > 0);
  if (opts.aiEnabled && dowOf(today) === 0 && stale && hasData) {
    try {
      const r = await explainForecastModel(model);
      model = { ...model, reasoning: { summary: r.summary, flags: r.flags, provider: r.provider, generatedAt: nowMs } };
      reasoned = true;
    } catch (e) {
      console.warn(`[learnForecastModel] store=${storeId} reasoning failed:`, e);
    }
  }

  if (learnedDays > 0 || reasoned || !existing) {
    await modelDoc(storeId).set({ ...model, updatedAtMs: nowMs });
  }
  return { learnedDays, bootstrapped: !existing, reasoned };
}

/** The model's next-7-day projection from today. Days whose weekday has no baseline yet are omitted. */
export async function forecastNext7(
  storeId: string, config: ForecastConfig | undefined, todayYmd: string, model: ForecastModel,
): Promise<({ date: string } & ModelDayForecast)[]> {
  const src = await loadContextSources(storeId, config, todayYmd, addDaysYmd(todayYmd, 6));
  const out: ({ date: string } & ModelDayForecast)[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysYmd(todayYmd, i);
    const f = forecastDay(model, buildDayContext(date, src, "forecast"));
    if (f) out.push({ date, ...f });
  }
  return out;
}
```

- [ ] **Step 2: Wire the learner into the accuracy cron**

In `src/lib/server/generate-forecast.ts`:

1. Delete the whole `backfillRecentAccuracy` function (the "Idempotently fills `accuracy`…" block).
2. In `generateForecastForStore`, delete the line `await backfillRecentAccuracy(store.id, today, 7);` and its `// 1. Backfill…` comment.
3. Add `import { learnForecastModel } from "@/lib/server/forecast-model";`.
4. Replace `updateAccuracyForAllActiveStores` with:

```ts
export async function updateAccuracyForAllActiveStores(): Promise<{
  totalStores: number;
  results: { storeId: string; ok: boolean; error?: string; learnedDays?: number; bootstrapped?: boolean; reasoned?: boolean }[];
}> {
  const db = getAdminDb();
  const activeStores = await getActiveStores(db);

  const results = await Promise.all(
    activeStores.map(async (s) => {
      try {
        const r = await learnForecastModel(s.id, (s.forecastConfig ?? undefined) as ForecastConfig | undefined, {
          aiEnabled: s.aiEnabled === true,
        });
        return { storeId: s.id, ok: true, ...r };
      } catch (err: any) {
        console.error(`[updateAccuracy] store=${s.id} failed:`, err);
        return { storeId: s.id, ok: false, error: err.message || String(err) };
      }
    }),
  );

  return { totalStores: activeStores.length, results };
}
```

The response shape of `src/app/api/cron/update-accuracy/route.ts` is unchanged, because it already spreads `result.results`.

- [ ] **Step 3: Typecheck and run all unit tests**

Run: `npx tsc --noEmit -p . && npm test`
Expected: no type errors, and all vitest suites PASS.

**Do not invoke the learner against production.** The first real run is the 4 AM cron after deploy, or a manual run once Ian approves it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/forecast-model.ts src/lib/server/generate-forecast.ts
git commit -m "feat(forecast): nightly learner in update-accuracy cron (replaces 7-day accuracy backfill)"
```

---

### Task 8: Engine switch in the daily forecast

**Files:**
- Modify: `src/lib/server/generate-forecast.ts`: `generateForecastForStore` and the `.filter(...)` in `generateForecastsForAllActiveStores`

**Interfaces:**
- Consumes: `loadForecastModel`, `forecastNext7` (Task 7); `forecastWeeklySales` returning `provider` (Task 6).

- [ ] **Step 1: Engine-aware AI gate and the model-only path**

At the top of `generateForecastForStore`, replace the AI-switch block:

```ts
  const engine = store.forecastConfig?.engine ?? "llm";
  // The AI switch only gates the LLM engine; the learned model needs no AI.
  if (engine === "llm" && !(await isStoreAiEnabled(db, store.id))) {
    return { storeId: store.id, ok: true, forecastsWritten: 0 };
  }
```

Then, as the first statements inside the `try {`:

```ts
    const todayYmd = anchorYmd(today);
    const model = await loadForecastModel(store.id);
    const modelDays = model ? await forecastNext7(store.id, store.forecastConfig, todayYmd, model) : [];

    if (engine === "model") {
      if (modelDays.length === 0) {
        return { storeId: store.id, ok: true, skipped: "Forecast model not built yet", forecastsWritten: 0 };
      }
      const batch = db.batch();
      for (const d of modelDays) {
        batch.set(db.doc(`stores/${store.id}/salesForecasts/${d.date}`), {
          date: d.date,
          projectedSales: d.sales,
          confidence: d.confidence,
          modelSales: d.sales,
          modelConfidence: d.confidence,
          drivers: d.drivers,
          llmSales: FieldValue.delete(),
          engine: "model",
          provider: "model",
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
      return { storeId: store.id, ok: true, forecastsWritten: modelDays.length };
    }
```

- [ ] **Step 2: Shadow fields on the LLM path**

Replace the "4. Write forecasts for next 7 days" block, from `const batch = db.batch();` through `await batch.commit();`, with:

```ts
    // 4. Write: model shadow fields for every day the model can project, then
    //    the LLM's number as projectedSales. Two merges to one doc in a batch is fine.
    const batch = db.batch();
    for (const d of modelDays) {
      batch.set(db.doc(`stores/${store.id}/salesForecasts/${d.date}`), {
        date: d.date, modelSales: d.sales, modelConfidence: d.confidence, drivers: d.drivers,
      }, { merge: true });
    }
    const todayDayIndex = anchorDayOfWeek(today);
    let writtenCount = 0;
    for (const daily of result.forecast) {
      const forecastDayIndex = DAY_NAMES.indexOf(daily.day);
      if (forecastDayIndex === -1) continue;
      let dayDiff = forecastDayIndex - todayDayIndex;
      if (dayDiff < 0) dayDiff += 7;
      const forecastDateStr = anchorYmd(addDays(today, dayDiff));
      batch.set(db.doc(`stores/${store.id}/salesForecasts/${forecastDateStr}`), {
        date: forecastDateStr,
        projectedSales: daily.forecastedSales,
        llmSales: daily.forecastedSales,
        confidence: daily.confidence ?? null,
        engine: "llm",
        provider: result.provider,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      writtenCount++;
    }
    await batch.commit();
```

Also change the comment `// 3. Call Gemini` to `// 3. Call the LLM (Claude first, Gemini fallback)`.

- [ ] **Step 3: Include model-engine stores in the cron**

In `generateForecastsForAllActiveStores`, change the filter to:

```ts
  // AI-enabled stores (LLM engine) plus any store already switched to the learned model.
  })).filter((s) => s.aiEnabled === true || s.forecastConfig?.engine === "model");
```

Add `import { forecastNext7, loadForecastModel, learnForecastModel } from "@/lib/server/forecast-model";`, merging with the Task 7 import.

- [ ] **Step 4: Typecheck and run unit tests**

Run: `npx tsc --noEmit -p . && npm test`
Expected: clean, all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/generate-forecast.ts
git commit -m "feat(forecast): engine switch — model shadow fields on LLM forecasts, model-only path"
```

---

### Task 9: Security rules

**Files:**
- Modify: `firestore.rules`: the excluded-collection list in `match /stores/{storeId}/{coll}/{docPath=**}` (around line 426)
- Modify: `tests/rules/store-scoped.test.ts`: `SERVER_ONLY_COLLECTIONS` (line 88 onward)

- [ ] **Step 1: Write the failing rules test**

In `tests/rules/store-scoped.test.ts`, add `"forecastModel",` as the last entry of `SERVER_ONLY_COLLECTIONS`, just before its closing `] as const;`, with this comment above it:

```ts
  // forecastModel: learned forecast factors + AI reasoning (src/lib/server/forecast-model.ts);
  // a client write would let any shift role rewrite a branch's forecast.
  "forecastModel",
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:rules`. This needs Java on PATH for the emulator.
Expected: the `denies … writing forecastModel` cases FAIL. If Java is missing, report that and continue. Do not mark this step done; note it in the task report.

- [ ] **Step 3: Lock the collection**

In `firestore.rules`, extend the list:

```
        && !(coll in ['analytics', 'analyticsMonths', 'analyticsYears', 'dashPresets', 'dailySessions',
                      'storefrontCatalog', 'storefrontConfig', 'onlineOrders', 'paymentIntents',
                      'catalogCache', 'inventoryCache', 'forecastModel'])
```

Add one line to the comment block above it: `// forecastModel: server-learned forecast factors — Admin SDK only.`

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:rules`
Expected: all PASS. Reads are still allowed through `hasStoreAccess`, which the UI needs.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/rules/store-scoped.test.ts
git commit -m "fix(rules): forecastModel is server-write only"
```

Rules deploy separately (`firebase deploy --only firestore:rules`). **Ask Ian before deploying.**

---

### Task 10: UI — drivers, model vs AI, reasoning, engine toggle

**Files:**
- Create: `src/hooks/useForecastModel.ts`
- Create: `src/components/dashboard/ForecastModelPanel.tsx`
- Modify: `src/hooks/useForecastAnalytics.ts`: expose `todaysDrivers`
- Modify: `src/components/dashboard/ForecastAccuracyTrendCard.tsx`: add a `drivers` prop and render the panel
- Modify: `src/components/dashboard/DashboardPageClient.tsx` (lines 122–128 and 262–270)
- Modify: `src/components/manager/store-settings/forecast-settings.tsx`

**Interfaces:**
- Consumes: `ForecastModel`, `wape`, `bias` (Task 2); `buildForecastConfig` (Task 5).
- Produces:
  - `useForecastModel(storeId?: string): { model: ForecastModel | null; isLoading: boolean }`
  - `<ForecastModelPanel storeId drivers />`

- [ ] **Step 1: Hook**

```ts
// src/hooks/useForecastModel.ts
"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { ForecastModel } from "@/lib/forecast/model";

export function useForecastModel(storeId?: string): { model: ForecastModel | null; isLoading: boolean } {
  const [model, setModel] = useState<ForecastModel | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(storeId));

  useEffect(() => {
    if (!storeId) { setModel(null); setIsLoading(false); return; }
    setIsLoading(true);
    return onSnapshot(
      doc(db, "stores", storeId, "forecastModel", "current"),
      (snap) => { setModel(snap.exists() ? (snap.data() as ForecastModel) : null); setIsLoading(false); },
      (err) => { console.error("forecastModel listen failed:", err); setModel(null); setIsLoading(false); },
    );
  }, [storeId]);

  return { model, isLoading };
}
```

- [ ] **Step 2: Panel**

```tsx
// src/components/dashboard/ForecastModelPanel.tsx
"use client";

import { useForecastModel } from "@/hooks/useForecastModel";
import { bias, wape } from "@/lib/forecast/model";

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

export function ForecastModelPanel({ storeId, drivers }: { storeId?: string; drivers?: string[] | null }) {
  const { model } = useForecastModel(storeId);
  const compared = model?.accuracy.model.n ?? 0;

  return (
    <div className="mt-4 space-y-3 border-t pt-3 text-sm">
      {drivers && drivers.length > 0 && (
        <div>
          <div className="font-medium">Why today&apos;s number</div>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {drivers.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </div>
      )}
      {model && compared > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div><div className="text-muted-foreground">Learned model error</div><div className="font-mono">{pct(wape(model.accuracy.model))} <span className="text-xs text-muted-foreground">bias {pct(bias(model.accuracy.model))}</span></div></div>
          <div><div className="text-muted-foreground">AI forecast error</div><div className="font-mono">{pct(wape(model.accuracy.llm))} <span className="text-xs text-muted-foreground">bias {pct(bias(model.accuracy.llm))}</span></div></div>
          <div className="col-span-2 text-xs text-muted-foreground">Compared over {compared} day{compared === 1 ? "" : "s"} · lower is better</div>
        </div>
      )}
      {model?.reasoning && (
        <div>
          <div className="font-medium">What drives this branch</div>
          <p className="mt-1 text-muted-foreground">{model.reasoning.summary}</p>
          {model.reasoning.flags.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {model.reasoning.flags.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            Reviewed {new Date(model.reasoning.generatedAt).toLocaleDateString("en-PH")} by {model.reasoning.provider === "claude" ? "Claude" : "Gemini"}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire it**

In `useForecastAnalytics.ts`:
- Add the state `const [todaysDrivers, setTodaysDrivers] = useState<string[] | null>(null);`.
- Set it to `null` in the `!storeId` branch.
- In the today-forecast snapshot, add `setTodaysDrivers(Array.isArray(snap.data().drivers) ? snap.data().drivers : null);` when the doc exists, else `setTodaysDrivers(null)`.
- Add `todaysDrivers` to the returned object.

In `ForecastAccuracyTrendCard.tsx`:
- Add `drivers?: string[] | null;` to the props interface and to the destructuring.
- Import `ForecastModelPanel`.
- Render `<ForecastModelPanel storeId={storeId} drivers={drivers} />` immediately after `<TodayForecastRow … />`.

In `DashboardPageClient.tsx`:
- Destructure `todaysDrivers` from `useForecastAnalytics`.
- Pass `drivers={todaysDrivers}` to `<ForecastAccuracyTrendCard …>`.

- [ ] **Step 4: Settings — engine toggle, payday hint, and keeping the engine on save**

In `forecast-settings.tsx`:
- Import `{ Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"`, `{ useForecastModel } from "@/hooks/useForecastModel"`, `{ wape } from "@/lib/forecast/model"`, and `{ buildForecastConfig } from "@/lib/utils/forecast-helpers"`.
- Add state: `const [engine, setEngine] = useState<"llm" | "model">(config.engine ?? "llm");` and `const { model } = useForecastModel(store.id);`.
- Replace the body of `handleSave`'s `try` up to `updateDoc` with:

```ts
      const forecastConfig: ForecastConfig = buildForecastConfig({
        holidays,
        payrollDatesText: customPayrollDates,
        storeContext,
        engine,
      });
```

- Change the payday hint `<p>` text to: `Comma-separated day numbers (1–31). <code>10, 31</code> means the 10th and end of month — 31 always means the last day of the month. Paydays on a weekend count as the Friday before.`
- Add this card before the "Sales Target Override" card:

```tsx
      {/* Forecast engine */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Forecast engine</CardTitle>
          <CardDescription>
            Which number becomes the daily forecast. The learned model runs alongside the AI forecast either way, so you can compare before switching.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Select value={engine} onValueChange={(v) => setEngine(v as "llm" | "model")}>
            <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="llm">AI forecast (current)</SelectItem>
              <SelectItem value="model">Learned model (no AI call)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {model && model.accuracy.model.n > 0
              ? `Recent error — learned model ${((wape(model.accuracy.model) ?? 0) * 100).toFixed(1)}%, AI ${((wape(model.accuracy.llm) ?? 0) * 100).toFixed(1)}% over ${model.accuracy.model.n} days (lower is better).`
              : "No side-by-side comparison yet — it fills in from the day after the model's first nightly run."}
            {model && model.accuracy.model.n > 0 && model.accuracy.model.n < 14 && " Fewer than 14 days compared — consider waiting."}
          </p>
        </CardContent>
      </Card>
```

- [ ] **Step 5: Verify in the browser**

1. Run `npx tsc --noEmit -p . && npm test`. Expected: clean.
2. Start the preview with `preview_start` (a `.claude/launch.json` entry `npm run dev`, port 9003).
3. Open the dashboard for a store with AI enabled. Check that the trend card renders, and that the panel shows nothing extra while `forecastModel/current` does not exist. That is the expected state before the first nightly run. Check that there are no console errors.
4. Open store settings → forecast. Check that the engine select shows "AI forecast (current)" and the "No side-by-side comparison yet" hint, and the new payday hint text.
5. **Do not click Save on a production store** unless Ian approves. Saving writes the store doc.
6. Take a screenshot of both screens for the report.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useForecastModel.ts src/components/dashboard/ForecastModelPanel.tsx src/hooks/useForecastAnalytics.ts src/components/dashboard/ForecastAccuracyTrendCard.tsx src/components/dashboard/DashboardPageClient.tsx src/components/manager/store-settings/forecast-settings.tsx
git commit -m "feat(forecast-ui): today's drivers, model vs AI error, weekly reasoning, engine toggle"
```

---

## After all tasks

1. Run `npm test`, `npx tsc --noEmit -p .`, and the Task 4 replay one more time. Put the numbers in the final report.
2. Ask Ian to approve the deploy and rules deploy. The first nightly 4 AM run bootstraps each store's model with 90 days.
3. After 14 days of shadow, Ian reads the comparison on the dashboard or in settings and switches each store's engine.
