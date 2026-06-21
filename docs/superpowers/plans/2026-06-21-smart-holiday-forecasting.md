# Smart Holiday Forecasting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual holiday logging with a per-store AI-generated holiday/occasion calendar, learn each holiday's real sales lift from history, and feed that learned lift into the weekly Gemini sales forecast.

**Architecture:** Pure logic modules (calendar window/merge, deterministic lift learning, cron scheduling) are unit-tested in isolation. A Genkit flow generates the calendar; thin server modules persist it and recompute learned effects; a `*/15` cron processes one "due" store per fire (≈weekly per store). The existing forecast reads the calendar + learned effects and passes enriched holiday strings to the same single Gemini call. The blocking start-of-shift holiday prompt is removed.

**Tech Stack:** Next.js (App Router), TypeScript, Genkit + `googleai/gemini-2.5-flash`, firebase-admin (Firestore), vitest, Google Cloud Scheduler.

## Global Constraints

- **Timezone:** all day math is Asia/Manila. Mirror the existing pattern `new Date(Date.now() + 8*3600*1000)` then read UTC getters to get Manila wall-clock (see `src/lib/server/weather-logger.ts`).
- **Model:** `googleai/gemini-2.5-flash` via `import { ai } from "@/ai/genkit"`.
- **AI gating:** only stores with `aiEnabled === true` AND `isStoreAiEnabled(db, storeId)` (from `@/lib/server/ai-enabled`) get Gemini calls.
- **Cron auth:** `Authorization: Bearer <CRON_SECRET>`. Reuse existing `CRON_SECRET` + `GEMINI_API_KEY` — **no new secret**.
- **Firestore admin:** `getAdminDb()` from `@/lib/firebase/admin`; `FieldValue`, `Timestamp` from `firebase-admin/firestore`.
- **Analytics date key:** analytics docs are keyed by `dayId` (YYYYMMDD, the canonical Manila day). When mapping sales to dates, use the **doc id**, not `meta.dayStartMs` (avoids a TZ off-by-one). Use `meta.dayStartMs` only for range queries.
- **`'use server'` files:** direct `export type Foo = ...` is fine (the existing forecast flow does it); never `export type { X }` re-export from a `'use server'`/actions file (causes a prod ReferenceError).
- **Tests:** vitest, co-located `src/**/*.test.ts`, node environment, `@` → `src` alias. Run a single file with `npx vitest run <path>`.
- **Commits:** frequent, one per task. Run `npm run typecheck` before every commit; logic tasks also run their vitest file. The final task runs the full `npm test` + `npm run build`.
- **Git:** this is the POS repo on branch `sev5_advanced`; push to its normal upstream (the ERP `upgrade-next16` rule does NOT apply here). Do not push unless asked.

---

### Task 1: Holiday calendar pure module (types, slug, upcoming-window merge)

**Files:**
- Create: `src/lib/holidays/holiday-calendar.ts`
- Test: `src/lib/holidays/holiday-calendar.test.ts`

**Interfaces:**
- Produces: `slugifyHoliday(name: string): string`, `dayIdToDate(dayId: string): string`, `buildUpcomingHolidays(args: { calendarDays: Record<string, HolidayCalendarEntry>; overrides: Record<string, string | null>; windowDayIds: string[] }): UpcomingHoliday[]`, and the types `HolidayType`, `HolidayScope`, `HolidayDriver`, `HolidayCalendarEntry`, `HolidayCalendar`, `UpcomingHoliday`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/holidays/holiday-calendar.test.ts
import { describe, it, expect } from "vitest";
import {
  slugifyHoliday,
  dayIdToDate,
  buildUpcomingHolidays,
  type HolidayCalendarEntry,
} from "@/lib/holidays/holiday-calendar";

const entry = (name: string): HolidayCalendarEntry => ({
  name, type: "commercial", scope: "national", driver: "up", confidence: "high",
});

describe("slugifyHoliday", () => {
  it("normalizes punctuation and spaces", () => {
    expect(slugifyHoliday("Father's Day")).toBe("fathers-day");
    expect(slugifyHoliday("All Saints' Day")).toBe("all-saints-day");
    expect(slugifyHoliday("Eid'l Fitr")).toBe("eidl-fitr");
  });
});

describe("dayIdToDate", () => {
  it("formats YYYYMMDD to YYYY-MM-DD", () => {
    expect(dayIdToDate("20260615")).toBe("2026-06-15");
  });
});

describe("buildUpcomingHolidays", () => {
  const windowDayIds = ["20260620", "20260621", "20260622"];

  it("includes calendar entries inside the window", () => {
    const res = buildUpcomingHolidays({
      calendarDays: { "20260621": entry("Father's Day") },
      overrides: {},
      windowDayIds,
    });
    expect(res).toEqual([
      { dayId: "20260621", date: "2026-06-21", name: "Father's Day", slug: "fathers-day" },
    ]);
  });

  it("lets a dailyContext override replace the calendar name", () => {
    const res = buildUpcomingHolidays({
      calendarDays: { "20260621": entry("Father's Day") },
      overrides: { "20260621": "Store Anniversary" },
      windowDayIds,
    });
    expect(res[0].name).toBe("Store Anniversary");
    expect(res[0].slug).toBe("store-anniversary");
  });

  it("treats override 'None' as a clear", () => {
    const res = buildUpcomingHolidays({
      calendarDays: { "20260621": entry("Father's Day") },
      overrides: { "20260621": "None" },
      windowDayIds,
    });
    expect(res).toEqual([]);
  });

  it("ignores days outside the window", () => {
    const res = buildUpcomingHolidays({
      calendarDays: { "20260615": entry("Mother's Day") },
      overrides: {},
      windowDayIds,
    });
    expect(res).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/holidays/holiday-calendar.test.ts`
Expected: FAIL — cannot resolve `@/lib/holidays/holiday-calendar`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/holidays/holiday-calendar.ts
// Pure helpers + types for the AI-generated per-store holiday calendar.
// No 'use server', no Firestore — safe to unit test and import anywhere.

export type HolidayType = "national" | "religious" | "commercial" | "fiesta" | "other";
export type HolidayScope = "national" | "local";
export type HolidayDriver = "up" | "down" | "neutral";

export type HolidayCalendarEntry = {
  name: string;
  type: HolidayType;
  scope: HolidayScope;
  driver: HolidayDriver;
  confidence: "high" | "medium" | "low";
};

export type HolidayCalendar = {
  year: number;
  storeId: string;
  locale: string;
  source: "ai";
  model: string;
  generatedAtMs: number;
  days: Record<string, HolidayCalendarEntry>; // key = dayId (YYYYMMDD)
};

export type UpcomingHoliday = { dayId: string; date: string; name: string; slug: string };

/** Stable slug used as the holidayEffects key. */
export function slugifyHoliday(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** YYYYMMDD -> YYYY-MM-DD */
export function dayIdToDate(dayId: string): string {
  return `${dayId.slice(0, 4)}-${dayId.slice(4, 6)}-${dayId.slice(6, 8)}`;
}

/**
 * Resolve which holidays fall inside an upcoming window. A dailyContext override
 * (manager edit) always wins over the AI calendar; an override of "None" clears
 * the day entirely.
 */
export function buildUpcomingHolidays(args: {
  calendarDays: Record<string, HolidayCalendarEntry>;
  overrides: Record<string, string | null>;
  windowDayIds: string[];
}): UpcomingHoliday[] {
  const { calendarDays, overrides, windowDayIds } = args;
  const out: UpcomingHoliday[] = [];
  for (const dayId of windowDayIds) {
    const override = overrides[dayId];
    let name: string | null = null;
    if (override !== undefined) {
      name = override && override !== "None" ? override : null; // override wins, incl. clear
    } else if (calendarDays[dayId]) {
      name = calendarDays[dayId].name;
    }
    if (name) out.push({ dayId, date: dayIdToDate(dayId), name, slug: slugifyHoliday(name) });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/holidays/holiday-calendar.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/holidays/holiday-calendar.ts src/lib/holidays/holiday-calendar.test.ts
git commit -m "feat(holidays): pure holiday-calendar module (slug, window merge)"
```

---

### Task 2: Holiday-effect learning pure module (baseline, EWMA lift, enrichment)

**Files:**
- Create: `src/lib/holidays/holiday-effects.ts`
- Test: `src/lib/holidays/holiday-effects.test.ts`

**Interfaces:**
- Consumes: `slugifyHoliday`, `UpcomingHoliday` from `@/lib/holidays/holiday-calendar`.
- Produces: `computeBaseline(targetDate, salesByDate, holidayDates): number | null`, `computeHolidayEffects(labeled: LabeledHolidayDay[], salesByDate: Record<string, number>): Record<string, HolidayEffect>`, `enrichUpcomingHolidays(upcoming: UpcomingHoliday[], effects: Record<string, HolidayEffect>): string[]`, and types `HolidayOccurrence`, `HolidayEffect`, `HolidayEffectsSummary`, `LabeledHolidayDay`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/holidays/holiday-effects.test.ts
import { describe, it, expect } from "vitest";
import {
  computeBaseline,
  computeHolidayEffects,
  enrichUpcomingHolidays,
  type LabeledHolidayDay,
  type HolidayEffect,
} from "@/lib/holidays/holiday-effects";

describe("computeBaseline", () => {
  it("averages same-weekday, non-holiday, non-zero days within ±28d", () => {
    const sales = { "2026-06-21": 1000, "2026-05-31": 300, "2026-06-14": 200 }; // all Sundays
    expect(computeBaseline("2026-06-21", sales, new Set())).toBe(250);
  });

  it("returns null with fewer than 2 qualifying samples", () => {
    const sales = { "2026-06-21": 1000, "2026-06-14": 200, "2026-06-19": 500 }; // 06-19 is Friday
    expect(computeBaseline("2026-06-21", sales, new Set())).toBeNull();
  });

  it("excludes holiday and zero-sales days", () => {
    const sales = { "2026-06-21": 1000, "2026-06-14": 200, "2026-06-07": 0, "2026-05-31": 400 };
    // 06-07 excluded (zero); 05-31 holiday → excluded; only 06-14 left → null
    expect(computeBaseline("2026-06-21", sales, new Set(["2026-05-31"]))).toBeNull();
  });
});

describe("computeHolidayEffects", () => {
  const labeled: LabeledHolidayDay[] = [
    { date: "2025-06-15", name: "Father's Day" },
    { date: "2026-06-21", name: "Father's Day" },
  ];
  const sales: Record<string, number> = {
    // 2025 Sundays: baseline 100, actual 140 -> +40%
    "2025-06-01": 100, "2025-06-08": 100, "2025-06-15": 140, "2025-06-22": 100, "2025-06-29": 100,
    // 2026 Sundays: baseline 200, actual 320 -> +60%
    "2026-06-07": 200, "2026-06-14": 200, "2026-06-21": 320, "2026-06-28": 200,
  };

  it("computes EWMA lift across occurrences (latest weighted most)", () => {
    const effects = computeHolidayEffects(labeled, sales);
    const fd = effects["fathers-day"];
    expect(fd.samples).toBe(2);
    expect(fd.lastDate).toBe("2026-06-21");
    expect(fd.occurrences).toHaveLength(2);
    // EWMA alpha 0.5 over [40, 60] = 0.5*60 + 0.5*40 = 50
    expect(fd.avgLiftPct).toBe(50);
  });

  it("skips occurrences with zero/no actual sales", () => {
    const withClosed = [...labeled, { date: "2026-01-01", name: "New Year's Day" }];
    const effects = computeHolidayEffects(withClosed, sales); // no 2026-01-01 sales
    expect(effects["new-years-day"]).toBeUndefined();
  });
});

describe("enrichUpcomingHolidays", () => {
  const upcoming = [
    { dayId: "20260621", date: "2026-06-21", name: "Father's Day", slug: "fathers-day" },
    { dayId: "20260217", date: "2026-02-17", name: "Chinese New Year", slug: "chinese-new-year" },
  ];

  it("renders measured lift with weekday and sample count", () => {
    const effects: Record<string, HolidayEffect> = {
      "fathers-day": { name: "Father's Day", slug: "fathers-day", avgLiftPct: 34, samples: 2, lastDate: "2026-06-21", occurrences: [] },
    };
    const out = enrichUpcomingHolidays(upcoming, effects);
    expect(out[0]).toContain("+34%");
    expect(out[0]).toContain("Sunday");
    expect(out[0]).toContain("2 past occasions");
    expect(out[1]).toContain("no measured history");
  });

  it("renders a negative lift and singular occasion", () => {
    const effects: Record<string, HolidayEffect> = {
      "fathers-day": { name: "Father's Day", slug: "fathers-day", avgLiftPct: -10, samples: 1, lastDate: "2025-06-15", occurrences: [] },
    };
    const out = enrichUpcomingHolidays(upcoming, effects);
    expect(out[0]).toContain("-10%");
    expect(out[0]).toContain("1 past occasion");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/holidays/holiday-effects.test.ts`
Expected: FAIL — cannot resolve `@/lib/holidays/holiday-effects`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/holidays/holiday-effects.ts
// Deterministic per-store holiday-lift learning. Pure — no Firestore, no AI.

import { slugifyHoliday, type UpcomingHoliday } from "@/lib/holidays/holiday-calendar";

export type HolidayOccurrence = { date: string; liftPct: number; baseline: number; actual: number };
export type HolidayEffect = {
  name: string;
  slug: string;
  avgLiftPct: number;   // EWMA across occurrences
  samples: number;
  lastDate: string;     // YYYY-MM-DD
  occurrences: HolidayOccurrence[]; // last MAX_OCCURRENCES, oldest→newest
};
export type HolidayEffectsSummary = {
  storeId: string;
  updatedAtMs: number;
  effects: Record<string, HolidayEffect>;
};
export type LabeledHolidayDay = { date: string; name: string }; // date = YYYY-MM-DD

const BASELINE_WINDOW_DAYS = 28;
const MIN_BASELINE_SAMPLES = 2;
const EWMA_ALPHA = 0.5;
const MAX_OCCURRENCES = 5;
const MIN_SAMPLES_FOR_NUMBER = 1;

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
function weekdayName(dateStr: string): string {
  return DOW[dayOfWeek(dateStr)];
}
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/**
 * Baseline for a holiday day = mean net sales of the SAME weekday within
 * ±BASELINE_WINDOW_DAYS, excluding holiday days and zero/closed days.
 * Returns null when fewer than MIN_BASELINE_SAMPLES qualifying days.
 */
export function computeBaseline(
  targetDate: string,
  salesByDate: Record<string, number>,
  holidayDates: Set<string>,
): number | null {
  const targetDow = dayOfWeek(targetDate);
  const samples: number[] = [];
  for (const [date, sales] of Object.entries(salesByDate)) {
    if (date === targetDate) continue;
    if (sales <= 0) continue;
    if (holidayDates.has(date)) continue;
    if (dayOfWeek(date) !== targetDow) continue;
    if (Math.abs(daysBetween(date, targetDate)) > BASELINE_WINDOW_DAYS) continue;
    samples.push(sales);
  }
  if (samples.length < MIN_BASELINE_SAMPLES) return null;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/** Per-holiday learned lift from labeled past days + actual sales. */
export function computeHolidayEffects(
  labeled: LabeledHolidayDay[],
  salesByDate: Record<string, number>,
): Record<string, HolidayEffect> {
  const holidayDates = new Set(labeled.map((l) => l.date));
  const bySlug = new Map<string, { name: string; occ: HolidayOccurrence[] }>();

  const sorted = [...labeled].sort((a, b) => a.date.localeCompare(b.date)); // oldest→newest
  for (const { date, name } of sorted) {
    const actual = salesByDate[date];
    if (actual == null || actual <= 0) continue;
    const baseline = computeBaseline(date, salesByDate, holidayDates);
    if (baseline == null || baseline <= 0) continue;
    const liftPct = Math.round((actual / baseline - 1) * 100);
    const slug = slugifyHoliday(name);
    if (!bySlug.has(slug)) bySlug.set(slug, { name, occ: [] });
    bySlug.get(slug)!.occ.push({ date, liftPct, baseline: Math.round(baseline), actual: Math.round(actual) });
  }

  const effects: Record<string, HolidayEffect> = {};
  for (const [slug, { name, occ }] of bySlug) {
    if (occ.length === 0) continue;
    let ewma = occ[0].liftPct;
    for (let i = 1; i < occ.length; i++) ewma = EWMA_ALPHA * occ[i].liftPct + (1 - EWMA_ALPHA) * ewma;
    effects[slug] = {
      name,
      slug,
      avgLiftPct: Math.round(ewma),
      samples: occ.length,
      lastDate: occ[occ.length - 1].date,
      occurrences: occ.slice(-MAX_OCCURRENCES),
    };
  }
  return effects;
}

/** Build the holiday context strings handed to the forecast model. */
export function enrichUpcomingHolidays(
  upcoming: UpcomingHoliday[],
  effects: Record<string, HolidayEffect>,
): string[] {
  return upcoming.map((h) => {
    const eff = effects[h.slug];
    if (eff && eff.samples >= MIN_SAMPLES_FOR_NUMBER) {
      const dir = eff.avgLiftPct >= 0 ? `+${eff.avgLiftPct}%` : `${eff.avgLiftPct}%`;
      const occ = eff.samples === 1 ? "1 past occasion" : `${eff.samples} past occasions`;
      return `${h.name} on ${h.date} — historically ${dir} vs a normal ${weekdayName(h.date)} at this branch (${occ}).`;
    }
    return `${h.name} on ${h.date} — no measured history yet at this branch; use judgment.`;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/holidays/holiday-effects.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/holidays/holiday-effects.ts src/lib/holidays/holiday-effects.test.ts
git commit -m "feat(holidays): deterministic holiday-effect learning + forecast enrichment"
```

---

### Task 3: Holiday cron scheduling pure helpers

**Files:**
- Create: `src/lib/holidays/holiday-cron.ts`
- Test: `src/lib/holidays/holiday-cron.test.ts`

**Interfaces:**
- Produces: `isoWeekKey(date: Date): string`, `pickDueStore(allStoreIds: string[], doneStoreIds: string[]): string | null`, `yearsToGenerate(now: Date): number[]`. All operate on UTC getters; callers pass a Manila-shifted Date.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/holidays/holiday-cron.test.ts
import { describe, it, expect } from "vitest";
import { isoWeekKey, pickDueStore, yearsToGenerate } from "@/lib/holidays/holiday-cron";

describe("isoWeekKey", () => {
  it("computes ISO week (UTC)", () => {
    expect(isoWeekKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-W01");
    expect(isoWeekKey(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-W02");
  });
});

describe("pickDueStore", () => {
  it("returns the first store not yet done", () => {
    expect(pickDueStore(["a", "b", "c"], ["a"])).toBe("b");
  });
  it("returns null when all are done", () => {
    expect(pickDueStore(["a", "b"], ["a", "b"])).toBeNull();
  });
});

describe("yearsToGenerate", () => {
  it("returns prior + current year normally", () => {
    expect(yearsToGenerate(new Date(Date.UTC(2026, 5, 15)))).toEqual([2025, 2026]);
  });
  it("adds next year in December", () => {
    expect(yearsToGenerate(new Date(Date.UTC(2026, 11, 10)))).toEqual([2025, 2026, 2027]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/holidays/holiday-cron.test.ts`
Expected: FAIL — cannot resolve `@/lib/holidays/holiday-cron`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/holidays/holiday-cron.ts
// Pure scheduling helpers for the weekly per-store holiday calendar cron.
// All use UTC getters; the caller passes a Manila-shifted Date.

export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;          // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);  // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** First store id not present in doneStoreIds, or null when all are done. */
export function pickDueStore(allStoreIds: string[], doneStoreIds: string[]): string | null {
  const done = new Set(doneStoreIds);
  for (const id of allStoreIds) if (!done.has(id)) return id;
  return null;
}

/** Prior + current year (so last year's holidays seed learning); + next year in December. */
export function yearsToGenerate(now: Date): number[] {
  const y = now.getUTCFullYear();
  const years = [y - 1, y];
  if (now.getUTCMonth() === 11) years.push(y + 1);
  return years;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/holidays/holiday-cron.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/holidays/holiday-cron.ts src/lib/holidays/holiday-cron.test.ts
git commit -m "feat(holidays): pure cron scheduling helpers (ISO week, due store, years)"
```

---

### Task 4: Genkit flow — generate the holiday calendar

**Files:**
- Create: `src/ai/flows/generate-holiday-calendar.ts`

**Interfaces:**
- Produces: `generateHolidayCalendar(input: HolidayCalendarFlowInput): Promise<HolidayCalendarFlowOutput>` where input is `{ locale: string; years: number[] }` and output is `{ entries: { dayId: string; name: string; type: HolidayType; scope: HolidayScope; driver: HolidayDriver; confidence: "high"|"medium"|"low" }[] }`.

- [ ] **Step 1: Write the flow**

```ts
// src/ai/flows/generate-holiday-calendar.ts
'use server';
/**
 * @fileOverview AI holiday/occasion calendar generator.
 * Returns dated holidays + commercial occasions + local fiestas for a locale and
 * one or more years. One Gemini call covers all requested years.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const EntrySchema = z.object({
  dayId: z.string().describe('Date as YYYYMMDD for the specific year requested.'),
  name: z.string().describe("Holiday or occasion name, e.g. \"Father's Day\"."),
  type: z.enum(['national', 'religious', 'commercial', 'fiesta', 'other']),
  scope: z.enum(['national', 'local']).describe("'local' for town/city fiestas specific to the locale."),
  driver: z.enum(['up', 'down', 'neutral']).describe('Coarse expected effect on restaurant dine-in sales.'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Certainty of the date and that it is observed in this locale.'),
});

const InputSchema = z.object({
  locale: z.string().describe("Store location, e.g. 'Malvar, Batangas, Philippines'."),
  years: z.array(z.number()).describe('Calendar years to produce, e.g. [2025, 2026].'),
});
export type HolidayCalendarFlowInput = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  entries: z.array(EntrySchema).describe('All holidays/occasions across the requested years.'),
});
export type HolidayCalendarFlowOutput = z.infer<typeof OutputSchema>;

export async function generateHolidayCalendar(input: HolidayCalendarFlowInput): Promise<HolidayCalendarFlowOutput> {
  return holidayCalendarFlow(input);
}

const prompt = ai.definePrompt({
  name: 'holidayCalendarPrompt',
  model: 'googleai/gemini-2.5-flash',
  input: { schema: InputSchema },
  output: { schema: OutputSchema },
  prompt: `You build a sales-relevant holiday & special-occasion calendar for a restaurant located in {{{locale}}}.

For EACH requested year ({{#each years}}{{{this}}} {{/each}}), list every date that could move restaurant dine-in sales:
- Philippine REGULAR holidays and SPECIAL (non-working) holidays, with the correct date for that year.
- Movable religious dates resolved per year: Holy Week (incl. Maundy Thursday, Good Friday, Black Saturday, Easter Sunday), Eid'l Fitr, Eid'l Adha, Chinese New Year.
- Widely-observed COMMERCIAL occasions even if not non-working: Valentine's Day, Mother's Day (2nd Sunday of May), Father's Day (3rd Sunday of June), Halloween, Christmas Eve, New Year's Eve, etc.
- LOCAL fiestas / town or city celebrations specific to {{{locale}}} (mark scope 'local').

Rules:
- Output a flat 'entries' array. One object per (date, occasion). 'dayId' MUST be YYYYMMDD for the specific year.
- Only include real, dated events. Do NOT invent fiestas you are unsure of — use confidence 'low' if unsure, or omit.
- 'driver' is the likely direction for a dine-in restaurant: 'up' (people dine out / celebrate), 'down' (people travel away or stay home), or 'neutral'.
- Do not include ordinary paydays or weekends.

Return ONLY the structured JSON.`,
});

const holidayCalendarFlow = ai.defineFlow(
  { name: 'holidayCalendarFlow', inputSchema: InputSchema, outputSchema: OutputSchema },
  async (input) => {
    const { output } = await prompt(input);
    if (!output) throw new Error('Holiday calendar prompt returned no output');
    return output;
  },
);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: (Optional) smoke the flow locally**

If `.env.local` has `GEMINI_API_KEY`, you may smoke it via the genkit dev UI: `npm run genkit:dev` then invoke `holidayCalendarFlow` with `{ "locale": "Malvar, Batangas, Philippines", "years": [2026] }` and confirm `entries[]` contains dated Father's Day / Holy Week / Christmas. Skip if no key locally — Task 6's force-run covers end-to-end.

- [ ] **Step 4: Commit**

```bash
git add src/ai/flows/generate-holiday-calendar.ts
git commit -m "feat(holidays): genkit flow to generate the holiday calendar"
```

---

### Task 5: Server — recompute learned holiday effects for a store

**Files:**
- Create: `src/lib/server/holiday-effects.ts`

**Interfaces:**
- Consumes: `computeHolidayEffects`, `LabeledHolidayDay` from `@/lib/holidays/holiday-effects`; `dayIdToDate` from `@/lib/holidays/holiday-calendar`.
- Produces: `recomputeHolidayEffectsForStore(storeId: string): Promise<{ ok: boolean; effectsCount: number }>`. Writes `stores/{storeId}/holidayEffects/summary`.

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/server/holiday-effects.ts
import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { computeHolidayEffects, type LabeledHolidayDay } from "@/lib/holidays/holiday-effects";
import { dayIdToDate } from "@/lib/holidays/holiday-calendar";

const MAX_LOOKBACK_DAYS = 731;
const BASELINE_PAD_DAYS = 29;

/**
 * Recompute and persist this store's learned holiday lifts from its AI calendar(s)
 * + dailyContext overrides + analytics sales. Deterministic, no AI call.
 */
export async function recomputeHolidayEffectsForStore(
  storeId: string,
): Promise<{ ok: boolean; effectsCount: number }> {
  const db = getAdminDb();

  // Manila "today" (UTC getters on a +8h-shifted clock).
  const manila = new Date(Date.now() + 8 * 3600 * 1000);
  const todayId = `${manila.getUTCFullYear()}${String(manila.getUTCMonth() + 1).padStart(2, "0")}${String(manila.getUTCDate()).padStart(2, "0")}`;

  // 1. Calendar entries across all stored years: dayId -> name.
  const calSnap = await db.collection(`stores/${storeId}/holidayCalendar`).get();
  const calDays: Record<string, string> = {};
  for (const d of calSnap.docs) {
    const days = (d.data()?.days ?? {}) as Record<string, { name: string }>;
    for (const id of Object.keys(days)) calDays[id] = days[id].name;
  }

  // 2. dailyContext overrides: dayId -> name (incl. "None").
  const dcSnap = await db.collection(`stores/${storeId}/dailyContext`).get();
  const overrides: Record<string, string> = {};
  for (const d of dcSnap.docs) {
    const h = d.data()?.holiday;
    if (h && typeof h.name === "string") overrides[d.id] = h.name;
  }

  // 3. Labeled PAST days (override wins; "None" clears).
  const labeled: LabeledHolidayDay[] = [];
  const allDayIds = new Set<string>([...Object.keys(calDays), ...Object.keys(overrides)]);
  for (const dayId of allDayIds) {
    if (dayId >= todayId) continue; // past only
    const ov = overrides[dayId];
    let name: string | null;
    if (ov !== undefined) name = ov && ov !== "None" ? ov : null;
    else name = calDays[dayId] ?? null;
    if (name) labeled.push({ date: dayIdToDate(dayId), name });
  }

  const summaryRef = db.doc(`stores/${storeId}/holidayEffects/summary`);
  if (labeled.length === 0) {
    await summaryRef.set({ storeId, updatedAtMs: Date.now(), effects: {} });
    return { ok: true, effectsCount: 0 };
  }

  // 4. Sales by date over a bounded range (range filter by dayStartMs; KEY by doc id).
  const earliest = labeled.map((l) => l.date).sort()[0];
  const earliestMs = Date.parse(`${earliest}T00:00:00Z`) - BASELINE_PAD_DAYS * 86400000;
  const floorMs = Date.now() - MAX_LOOKBACK_DAYS * 86400000;
  const lowerMs = Math.max(earliestMs, floorMs);

  const anSnap = await db
    .collection(`stores/${storeId}/analytics`)
    .where("meta.dayStartMs", ">=", lowerMs)
    .orderBy("meta.dayStartMs", "asc")
    .get();

  const salesByDate: Record<string, number> = {};
  for (const d of anSnap.docs) {
    salesByDate[dayIdToDate(d.id)] = d.data()?.payments?.totalGross ?? 0; // doc id = Manila dayId
  }

  const effects = computeHolidayEffects(labeled, salesByDate);
  await summaryRef.set({ storeId, updatedAtMs: Date.now(), effects });
  return { ok: true, effectsCount: Object.keys(effects).length };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/holiday-effects.ts
git commit -m "feat(holidays): server recompute of learned holiday effects"
```

---

### Task 6: Server — generate + store calendar, and the due-store cron driver

**Files:**
- Create: `src/lib/server/holiday-calendar.ts`

**Interfaces:**
- Consumes: `generateHolidayCalendar` from `@/ai/flows/generate-holiday-calendar`; `isStoreAiEnabled` from `@/lib/server/ai-enabled`; `isoWeekKey`, `pickDueStore`, `yearsToGenerate` from `@/lib/holidays/holiday-cron`; `recomputeHolidayEffectsForStore` from `@/lib/server/holiday-effects`; `HolidayCalendarEntry` from `@/lib/holidays/holiday-calendar`.
- Produces: `generateAndStoreHolidayCalendar(store: { id: string; address?: string }, years: number[]): Promise<{ storeId: string; yearsWritten: number; entriesWritten: number }>` and `runHolidayCalendarForDueStore(): Promise<{ skipped: boolean; reason: string; storeId?: string; result?: { storeId: string; yearsWritten: number; entriesWritten: number } }>`.

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/server/holiday-calendar.ts
import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { isStoreAiEnabled } from "@/lib/server/ai-enabled";
import { generateHolidayCalendar } from "@/ai/flows/generate-holiday-calendar";
import { isoWeekKey, pickDueStore, yearsToGenerate } from "@/lib/holidays/holiday-cron";
import { recomputeHolidayEffectsForStore } from "@/lib/server/holiday-effects";
import type { HolidayCalendarEntry } from "@/lib/holidays/holiday-calendar";

const MODEL = "googleai/gemini-2.5-flash";
const HOLIDAY_CRON_LOG = "system/holidayCronLog";

/** One Gemini call → per-year `holidayCalendar/{YYYY}` docs (deep-merged). */
export async function generateAndStoreHolidayCalendar(
  store: { id: string; address?: string },
  years: number[],
): Promise<{ storeId: string; yearsWritten: number; entriesWritten: number }> {
  const db = getAdminDb();
  const locale = store.address?.trim() || "Philippines";

  const { entries } = await generateHolidayCalendar({ locale, years });

  const byYear = new Map<number, Record<string, HolidayCalendarEntry>>();
  for (const e of entries) {
    if (!/^\d{8}$/.test(e.dayId)) continue;
    const y = Number(e.dayId.slice(0, 4));
    if (!years.includes(y)) continue;
    if (!byYear.has(y)) byYear.set(y, {});
    byYear.get(y)![e.dayId] = {
      name: e.name, type: e.type, scope: e.scope, driver: e.driver, confidence: e.confidence,
    };
  }

  const batch = db.batch();
  let entriesWritten = 0;
  const now = Date.now();
  for (const [y, days] of byYear) {
    const ref = db.doc(`stores/${store.id}/holidayCalendar/${y}`);
    batch.set(
      ref,
      { year: y, storeId: store.id, locale, source: "ai", model: MODEL, generatedAtMs: now, days },
      { merge: true }, // deep-merges `days` so proclaimed dates append without dropping prior ones
    );
    entriesWritten += Object.keys(days).length;
  }
  await batch.commit();

  return { storeId: store.id, yearsWritten: byYear.size, entriesWritten };
}

async function markStoreDone(weekKey: string, storeId: string): Promise<void> {
  const db = getAdminDb();
  await db.doc(HOLIDAY_CRON_LOG).set(
    { weeks: { [weekKey]: { doneStoreIds: FieldValue.arrayUnion(storeId), lastFireAt: Timestamp.now() } } },
    { merge: true },
  );
}

/**
 * Process ONE store that hasn't been refreshed this ISO week. Generates its
 * calendar, recomputes its learned effects, and marks it done. Each `*/15` fire
 * advances one store, so every active AI store is refreshed ≈weekly.
 */
export async function runHolidayCalendarForDueStore(): Promise<{
  skipped: boolean;
  reason: string;
  storeId?: string;
  result?: { storeId: string; yearsWritten: number; entriesWritten: number };
}> {
  const db = getAdminDb();
  const manila = new Date(Date.now() + 8 * 3600 * 1000);
  const weekKey = isoWeekKey(manila);

  const logSnap = await db.doc(HOLIDAY_CRON_LOG).get();
  const doneStoreIds: string[] = logSnap.exists
    ? (logSnap.data()?.weeks?.[weekKey]?.doneStoreIds ?? [])
    : [];

  const storesSnap = await db.collection("stores").where("isActive", "==", true).get();
  const aiStoreIds: string[] = [];
  const storeById = new Map<string, { id: string; address?: string }>();
  for (const d of storesSnap.docs) {
    const data = d.data();
    if (data.aiEnabled !== true) continue;
    aiStoreIds.push(d.id);
    storeById.set(d.id, { id: d.id, address: data.address });
  }

  const dueId = pickDueStore(aiStoreIds, doneStoreIds);
  if (!dueId) return { skipped: true, reason: `All ${aiStoreIds.length} AI store(s) done for ${weekKey}.` };

  // Honor the master AI switch; mark done so we don't retry it all week.
  if (!(await isStoreAiEnabled(db, dueId))) {
    await markStoreDone(weekKey, dueId);
    return { skipped: true, reason: `Store ${dueId} AI disabled; marked done.`, storeId: dueId };
  }

  const years = yearsToGenerate(manila);
  const result = await generateAndStoreHolidayCalendar(storeById.get(dueId)!, years);
  await recomputeHolidayEffectsForStore(dueId);
  await markStoreDone(weekKey, dueId);

  return { skipped: false, reason: `Generated holiday calendar for ${dueId} (${weekKey}).`, storeId: dueId, result };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/holiday-calendar.ts
git commit -m "feat(holidays): server generate+store calendar and due-store cron driver"
```

---

### Task 7: Cron route + docs

**Files:**
- Create: `src/app/api/cron/holiday-calendar/route.ts`
- Modify: `docs/CRON.md` (add the job to the table + a description + a provisioning block)

**Interfaces:**
- Consumes: `runHolidayCalendarForDueStore` from `@/lib/server/holiday-calendar`.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/cron/holiday-calendar/route.ts
import { NextResponse } from "next/server";
import { runHolidayCalendarForDueStore } from "@/lib/server/holiday-calendar";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/holiday-calendar] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const res = await runHolidayCalendarForDueStore();
    return NextResponse.json({ ok: true, ...res });
  } catch (err: any) {
    console.error("[cron/holiday-calendar] failed:", err);
    return NextResponse.json({ error: err.message || "Holiday calendar cron failed." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Update `docs/CRON.md`**

Add this row to the jobs table:

```markdown
| `holiday-calendar`         | `GET /api/cron/holiday-calendar`    | `*/15 * * * *` (every 15 min)   | 120s             |
```

Add this description paragraph after the `log-weather` paragraph:

```markdown
`holiday-calendar` processes ONE "due" store per fire. A per-store AI holiday/
occasion calendar is generated (`stores/<storeId>/holidayCalendar/<YYYY>`,
Gemini, prior+current year so last year seeds learning) and the store's learned
holiday lifts are recomputed deterministically into
`stores/<storeId>/holidayEffects/summary`. "Due" = an active AI store not yet in
`system/holidayCronLog.weeks[<ISO-week>].doneStoreIds`; once all are done the
fires are cheap no-ops until the next ISO week, giving a ≈weekly refresh that
also catches newly-proclaimed special days. Reuses `CRON_SECRET` + `GEMINI_API_KEY`.
```

Add this provisioning block alongside the others:

```bash
gcloud scheduler jobs create http holiday-calendar \
  --location="$REGION" \
  --schedule="*/15 * * * *" \
  --time-zone="Asia/Manila" \
  --uri="$BACKEND_URL/api/cron/holiday-calendar" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON_SECRET" \
  --attempt-deadline=120s
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: (Manual, post-deploy or with local `.env.local`) force-run verification**

Run (local dev with `.env.local` admin creds + `GEMINI_API_KEY`): start `npm run dev`, then
`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/holiday-calendar`
Expected JSON: `{ ok: true, skipped: false, storeId: "...", result: { entriesWritten: >0 } }`.
Verify in Firestore: `stores/<storeId>/holidayCalendar/2026` has a `days` map and
`stores/<storeId>/holidayEffects/summary` exists. Re-run to advance to the next store.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/holiday-calendar/route.ts docs/CRON.md
git commit -m "feat(holidays): holiday-calendar cron route + CRON docs"
```

---

### Task 8: Forecast integration — read calendar + learned lift, enrich the prompt

**Files:**
- Modify: `src/lib/server/generate-forecast.ts`
- Modify: `src/ai/flows/forecast-weekly-sales.ts` (prompt rule #5 only)

**Interfaces:**
- Consumes: `buildUpcomingHolidays` from `@/lib/holidays/holiday-calendar`; `enrichUpcomingHolidays` from `@/lib/holidays/holiday-effects`. The forecast keeps passing `upcomingHolidays: string[]` to the model — no schema change.

- [ ] **Step 1: Add imports to `generate-forecast.ts`**

After the existing `import { getUpcomingPayrollDates, ... } from "@/lib/utils/forecast-helpers";` line, add:

```ts
import { buildUpcomingHolidays, type HolidayCalendarEntry } from "@/lib/holidays/holiday-calendar";
import { enrichUpcomingHolidays } from "@/lib/holidays/holiday-effects";
```

- [ ] **Step 2: Widen the dailyContext window to include upcoming days**

In `generateForecastForStore`, the `dailyContext` query currently upper-bounds at `todayDayId`. Change it so future overrides (manager pre-marks a holiday) are visible. Replace:

```ts
      db.collection(`stores/${store.id}/dailyContext`)
        .where("dayId", ">=", startDayId)
        .where("dayId", "<=", todayDayId)
        .get(),
```

with:

```ts
      db.collection(`stores/${store.id}/dailyContext`)
        .where("dayId", ">=", startDayId)
        .where("dayId", "<=", format(addDays(now, 6), "yyyyMMdd"))
        .get(),
```

- [ ] **Step 3: Replace the holiday-building block**

Replace this existing block:

```ts
    const loggedHolidays = dailyContextDocs
      .filter(dc => dc.holiday && dc.holiday.name !== "None")
      .map(dc => {
        const dateStr = dc.dayId.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
        return `${dc.holiday!.name} on ${dateStr}`;
      });
    const todayContext = dailyContextDocs.find(dc => dc.dayId === todayDayId);

    const config = store.forecastConfig;
    const upcomingPayrollDates = getUpcomingPayrollDates(config);
    const configHolidays = getUpcomingHolidays(config).map(h => `${h.name} on ${h.date}`);
    const upcomingHolidays = [...new Set([...configHolidays, ...loggedHolidays])];
```

with:

```ts
    const todayContext = dailyContextDocs.find(dc => dc.dayId === todayDayId);

    const config = store.forecastConfig;
    const upcomingPayrollDates = getUpcomingPayrollDates(config);

    // Holidays: AI per-store calendar (+ dailyContext overrides), enriched with
    // this branch's learned lift. Falls back to config/default holidays when the
    // calendar hasn't been generated yet.
    const calYears = [...new Set([format(now, "yyyy"), format(addDays(now, 6), "yyyy")])];
    const calSnaps = await Promise.all(
      calYears.map((y) => db.doc(`stores/${store.id}/holidayCalendar/${y}`).get()),
    );
    const calendarDays: Record<string, HolidayCalendarEntry> = {};
    for (const s of calSnaps) {
      if (s.exists) Object.assign(calendarDays, (s.data()?.days ?? {}) as Record<string, HolidayCalendarEntry>);
    }
    const effectsSnap = await db.doc(`stores/${store.id}/holidayEffects/summary`).get();
    const effects = (effectsSnap.exists ? effectsSnap.data()?.effects : {}) ?? {};

    const windowDayIds = Array.from({ length: 7 }, (_, i) => format(addDays(now, i), "yyyyMMdd"));
    const overrides: Record<string, string | null> = {};
    for (const dc of dailyContextDocs) {
      if (dc.holiday?.name) overrides[dc.dayId] = dc.holiday.name;
    }
    const upcoming = buildUpcomingHolidays({ calendarDays, overrides, windowDayIds });
    const enriched = enrichUpcomingHolidays(upcoming, effects);
    const upcomingHolidays = enriched.length
      ? enriched
      : getUpcomingHolidays(config).map((h) => `${h.name} on ${h.date}`);
```

(`getUpcomingHolidays` stays imported — it is now the fallback.)

- [ ] **Step 4: Update the forecast prompt's Holidays rule**

In `src/ai/flows/forecast-weekly-sales.ts`, replace:

```
5.  **Holidays**: Consider any upcoming local holidays. Some holidays boost sales (e.g., Christmas), while others might decrease them if people leave town.
```

with:

```
5.  **Holidays & special occasions**: Each upcoming holiday line may include THIS branch's measured historical lift versus a normal same-weekday (learned from past occurrences here). When a lift figure is given (e.g. "+34% vs a normal Sunday"), apply it to that day instead of guessing; when it says "no measured history yet", treat the day cautiously and lower its confidence. Occasions like Mother's Day, Father's Day, and Valentine's often drive large swings even when they are not non-working holidays.
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: (Manual) force-run a forecast and inspect**

After Task 7's calendar exists for a store, trigger the existing forecast refresh
(`src/app/api/admin/refresh-forecast/route.ts`) for that store and confirm the
generated `stores/<storeId>/salesForecasts/<date>` for a holiday day reflects a
sensible lift, and that no errors are logged. (If running locally lacks creds,
defer to post-deploy verification on `/dashboard`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/generate-forecast.ts src/ai/flows/forecast-weekly-sales.ts
git commit -m "feat(forecast): use AI holiday calendar + learned lift as model context"
```

---

### Task 9: Remove the blocking start-of-shift holiday prompt

**Files:**
- Modify: `src/app/cashier/page.tsx`
- Delete: `src/components/shared/StartShiftModal.tsx`
- Keep: `src/lib/holidays/known-holidays.ts` (still used by `DayDetailDrawer`).

**Interfaces:** none exported; this is cleanup. The manager override (`DayDetailDrawer` writing `dailyContext`) is untouched.

- [ ] **Step 1: Replace `src/app/cashier/page.tsx` with the modal removed**

```tsx
"use client";

import { Suspense, useEffect } from 'react';
import { useSearchParams } from "next/navigation";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useToast } from "@/hooks/use-toast";
import { useLocalProfile } from "@/context/local-profile-context";
import { useIdleTimer } from "@/hooks/useIdleTimer";

const SessionDetailView = dynamic(
  () => import('@/components/cashier/session-detail-view').then((mod) => mod.SessionDetailView),
  {
    loading: () => <div className="flex items-center justify-center h-screen"><Loader2 className="h-10 w-10 animate-spin" /></div>,
    ssr: false,
  }
);

const SessionListView = dynamic(
  () => import('@/components/cashier/session-list-view').then((mod) => mod.SessionListView),
  {
    loading: () => <div className="flex items-center justify-center h-screen"><Loader2 className="h-10 w-10 animate-spin" /></div>,
    ssr: false,
  }
);

function CashierPageContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams?.get('sessionId') ?? null;
  const { toast } = useToast();
  const { currentProfile, signOut } = useLocalProfile();

  // Idle auto sign-out (30 minutes), mirroring the server station.
  const { isIdle } = useIdleTimer({ idleMs: 30 * 60_000 });
  useEffect(() => {
    if (isIdle && currentProfile) {
      signOut();
      toast({ title: "Signed out", description: "Inactive for 30 minutes." });
    }
  }, [isIdle, currentProfile, signOut, toast]);

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      {sessionId ? <SessionDetailView sessionId={sessionId} /> : <SessionListView />}
    </RoleGuard>
  );
}

export default function CashierPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>}>
      <CashierPageContent />
    </Suspense>
  )
}
```

- [ ] **Step 2: Delete the modal component**

```bash
git rm src/components/shared/StartShiftModal.tsx
```

- [ ] **Step 3: Confirm nothing else imports it**

Run: `grep -rn "StartShiftModal" src` (or use the editor's search)
Expected: no matches.

- [ ] **Step 4: Full verification — types, tests, build**

```bash
npm run typecheck
npm test
npm run build
```
Expected: typecheck clean; all vitest files pass (including the three new ones); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/cashier/page.tsx
git commit -m "chore(cashier): remove blocking start-of-shift holiday prompt (AI fills the calendar)"
```

---

## Rollout notes (after the plan is implemented)

1. Deploy/roll out the backend so the new route exists.
2. Create the Cloud Scheduler job (Task 7 provisioning block).
3. **Backfill:** hit `GET /api/cron/holiday-calendar` once per active store (it
   advances one store per call) — this generates prior+current-year calendars and
   populates `holidayEffects/summary` from existing analytics, so cross-year
   learning (e.g. last Father's Day → next Father's Day) is live immediately for
   holidays that already occurred within your data window.
4. The next nightly forecast run automatically picks up the calendar + learned lift.

## Self-Review

- **Spec coverage:**
  - Component A (per-store AI calendar, weekly/15-min, override layer) → Tasks 4, 6, 7. ✓
  - Component B (deterministic learning, EWMA, ≥2 baseline samples, backfill) → Tasks 2, 5. ✓
  - Component C (feed learned lift as context, calendar-sourced upcoming, prompt update) → Task 8. ✓
  - Component D (remove blocking modal, keep override) → Task 9. ✓
  - Data shapes (`holidayCalendar/{YYYY}`, `holidayEffects/summary`, run-log) → Tasks 1, 2, 5, 6. ✓
  - Edge cases (zero/closed exclusion, <2 samples note, year rollover, proclaimed-day merge) → Tasks 2 (exclusion/threshold), 3/6 (rollover via `yearsToGenerate`), 6 (`merge:true` append). ✓
- **Placeholder scan:** none — every code/step is concrete. Manual force-run steps are explicit (curl + expected JSON), not "test the above."
- **Type consistency:** `HolidayCalendarEntry`, `UpcomingHoliday`, `HolidayEffect`, `LabeledHolidayDay`, `HolidayEffectsSummary` defined in Tasks 1–2 and consumed with matching shapes in Tasks 5, 6, 8. `slugifyHoliday`/`dayIdToDate` (Task 1) reused in Tasks 2, 5. `isoWeekKey`/`pickDueStore`/`yearsToGenerate` (Task 3) consumed in Task 6. Flow `entries[]` shape (Task 4) matches `generateAndStoreHolidayCalendar`'s mapping (Task 6). ✓
