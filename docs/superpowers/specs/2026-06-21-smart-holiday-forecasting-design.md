# Smart Holiday Forecasting — Design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan
**Area:** Sales forecast / AI

## Goal

Replace manual holiday logging with an **AI-generated per-store holiday/occasion
calendar**, and make the sales forecast **learn each holiday's real impact** so
recurring occasions (Mother's Day, Father's Day, Valentine's, Holy Week, Chinese
New Year, Eid, local town fiestas, etc.) are projected from this branch's own
history instead of being guessed.

Two top-of-mind constraints from the request:

- **Efficiency in AI use** — minimize Gemini calls; do the learning with
  deterministic math, not AI.
- **Effectivity in forecast** — the forecast must actually improve year over
  year ("last Father's Day ran +35%, so next Father's Day projects higher").

## Current state (what we build on)

- **Three overlapping, manual/static holiday sources:**
  - `src/lib/holidays/ph-regular-holidays.ts` — 11 fixed-date MMDD presets
    (`getPresetHolidayName`); used for calendar display.
  - `src/lib/holidays/known-holidays.ts` — 25 autocomplete strings (incl.
    Mother's/Father's Day) for manual entry.
  - `src/lib/utils/forecast-helpers.ts` `DEFAULT_HOLIDAYS` /
    `config.customHolidays` — `getUpcomingHolidays(config)`.
  - `dailyContext/{dayId}.holiday` — logged by the **blocking** `StartShiftModal`
    or a manager via the weather-calendar `DayDetailDrawer`.
- **Forecast** (`generateForecastForStore` → `forecastWeeklySales`, Gemini 2.5
  Flash) already passes upcoming holidays — but **only as a name + date string**
  (e.g. `"Father's Day on 2026-06-15"`). The 28-day history window almost never
  contains the same holiday, so the model has **no empirical basis** for the
  lift. There is no learning.
- **A pattern to mirror:** weather is logged into a cheap monthly doc
  (`weatherForecasts/{YYYY-MM}`); the forecast reads those docs and never calls
  the API itself. A per-store `weatherSensitivity` string is already computed
  from history and fed to the model — the exact shape holiday-lift learning
  should take.
- **Forecasts already store** `projectedSales` + `actualSales` + `accuracy` per
  day (`stores/{storeId}/salesForecasts/{date}`), and per-day analytics
  (`stores/{storeId}/analytics/{dayId}`, `payments.totalGross`) — so historical
  lift can be computed **deterministically and backfilled** from existing data.

## Decisions (locked)

1. **Calendar scope:** per-store AI calendar (so local town fiestas come in from
   the store address). Refreshed weekly, one store per cron fire (~15-min
   spacing) to keep AI bursts low.
2. **How learned lift feeds the forecast:** feed it to the existing Gemini
   forecast **as context** (one source of truth, blends with weather/trend/
   payday). No extra AI call in the forecast path.
3. **Manual logging:** remove the blocking `StartShiftModal` holiday prompt;
   keep the calendar day-drawer as a manager correction/override.

Tunables chosen as defaults (changeable later): EWMA weights the latest
occurrence ~0.5 (most recent year dominates); a lift number requires **≥2
same-weekday baseline samples** before it is trusted.

---

## Component A — AI Holiday Calendar (per store, weekly)

### Data shape

New doc per store per year: `stores/{storeId}/holidayCalendar/{YYYY}`, keyed by
dayId (YYYYMMDD) for O(1) lookups.

```ts
type HolidayCalendarEntry = {
  name: string;                       // "Father's Day"
  type: "national" | "religious" | "commercial" | "fiesta" | "other";
  scope: "national" | "local";
  driver: "up" | "down" | "neutral"; // AI's coarse prior on sales direction
  confidence: "high" | "medium" | "low";
};

type HolidayCalendar = {
  year: number;
  storeId: string;
  locale: string;                     // from store address, e.g. "Malvar, Batangas, PH"
  source: "ai";
  model: string;                      // "googleai/gemini-2.5-flash"
  generatedAtMs: number;
  days: Record<string, HolidayCalendarEntry>; // key = dayId
};
```

### Generation

- A new Genkit flow `generateHolidayCalendar` takes `{ locale, year }` and
  returns the full-year map. The prompt asks for official PH regular + special
  non-working holidays, widely-observed commercial occasions (Valentine's,
  Mother's/Father's Day, Christmas season, etc.), movable religious dates (Holy
  Week, Eid'l Fitr/Adha, Chinese New Year), and known **local fiestas** for the
  locale, each with `type`/`scope`/`driver`/`confidence`. The model resolves the
  variable dates and locale-specific events a static table cannot.
- A single call may return a 24-month span (prior year + current year + next 12
  months); results are split and written into per-year docs. This gives
  immediate cross-year learning material (see Component B backfill).

### Cron

- New endpoint `GET /api/cron/holiday-calendar`, auth via `Authorization:
  Bearer <CRON_SECRET>` (same as other crons; no new secret — reuses
  `CRON_SECRET` + `GEMINI_API_KEY`).
- Schedule `*/15 * * * *` (Asia/Manila). **Each fire processes one "due" store.**
  A store is due if its current-year calendar doc is missing or
  `generatedAtMs` is >6 days old. December fires also ensure next year's doc.
- Dedup/tracking: `system/holidayCronLog` →
  `{ weeks: { "<ISO-week>": { doneStoreIds: string[], lastFireAt } } }`.
  Once all active stores are done for the ISO week, fires are cheap no-ops.
- This matches the requested "weekly, ~15-min interval per store," spreads
  Gemini calls, and the weekly cadence is what catches mid-year proclaimed
  special days (re-ask + merge).

### Override layer (kept)

- Manager edits via `DayDetailDrawer` continue writing
  `dailyContext/{dayId}.holiday`. **`dailyContext` overrides always win** over
  the AI calendar for display, learning, and forecast.
- `config.customHolidays` remains an optional manual supplement, merged in.

---

## Component B — Holiday-Effect Learning (deterministic, no AI)

### Data shape

New single doc `stores/{storeId}/holidayEffects` (id `summary`), keyed by holiday
slug:

```ts
type HolidayOccurrence = { date: string; liftPct: number; baseline: number; actual: number };
type HolidayEffect = {
  name: string;
  slug: string;                 // slug(name), e.g. "fathers-day"
  avgLiftPct: number;           // EWMA across occurrences
  samples: number;
  lastDate: string;             // YYYY-MM-DD
  occurrences: HolidayOccurrence[]; // last ~5, newest last
};
type HolidayEffectsSummary = {
  storeId: string;
  updatedAtMs: number;
  effects: Record<string, HolidayEffect>; // key = slug
};
```

### Algorithm (runs in the same weekly per-store pass)

1. Build the labeled set of **past** holiday days from the calendar doc(s) +
   `dailyContext` overrides (override name wins).
2. For each labeled past day that has a real `actualSales` value (from analytics
   `payments.totalGross`, or `salesForecasts.actualSales`):
   - `baseline` = mean net sales of the **same weekday within ±28 days**,
     **excluding** labeled-holiday days and closed/zero-sales days.
   - Require **≥2 baseline samples**, else skip the occurrence (low confidence).
   - `liftPct = round((actual / baseline − 1) * 100)`.
3. Group occurrences by holiday slug; compute **EWMA** over occurrences sorted by
   date (alpha ≈ 0.5 so the most recent year dominates). Keep the last ~5 raw
   occurrences and the sample count.
4. Write `holidayEffects/summary`.

Cost: Firestore reads only, no Gemini. Cheap and idempotent.

---

## Component C — Forecast integration (feed learned lift as context)

In `generateForecastForStore`:

- Source upcoming holidays from the **AI calendar doc** (current year, plus next
  year's doc when the 7-day window crosses Dec 31) + `dailyContext` overrides.
  `getUpcomingHolidays(config)` becomes the fallback when no calendar doc exists.
- Read `holidayEffects/summary` (1 cheap doc) and **enrich each upcoming holiday
  string**, reusing the existing `upcomingHolidays: string[]` field (zero schema
  churn):
  - measured: `"Father's Day on 2026-06-15 — historically +34% vs a normal Sunday at this branch (2 past occasions)."`
  - unmeasured: `"Chinese New Year on 2026-02-17 — no measured history yet at this branch; use judgment."`
- Update the `forecastWeeklySales` prompt's **Holidays** rule so the model applies
  a stated historical lift the same way it already applies per-branch
  `weatherSensitivity`, and lowers confidence for unmeasured holidays.

No new AI calls in the forecast path — same one call per store, richer context.

### AI cost summary

- Holiday calendar: ~1 Gemini call per store per week (e.g. 6 stores ≈ 6/week).
- Learning: 0 AI calls.
- Forecast: unchanged call count; +1 `holidayEffects` read, +1–2 calendar reads.

---

## Component D — Remove the blocking prompt

- Remove the `StartShiftModal` holiday gate from the cashier flow (AI already
  knows the day).
- Keep the `DayDetailDrawer` manager override.
- **Impl note:** verify `StartShiftModal` is holiday-only and that `isPayday`
  is not logged solely through it before removing; if payday logging depends on
  it, preserve that path.

---

## Rollout

1. Ship data shapes + `generateHolidayCalendar` flow + cron (forecast unchanged).
2. One-time backfill: generate prior + current-year calendars per store; run the
   learning pass once → populates `holidayEffects` from existing analytics.
3. Flip the forecast to read the calendar + learned lift.
4. Remove the blocking modal.

## Edge cases

- **AI hallucination / wrong date:** manager override corrects it; a phantom
  holiday with normal sales yields ~0% lift (harmless to the model).
- **New store / <2 occurrences:** emit the "no measured history" note; model
  uses judgment, confidence low.
- **Store closed on a holiday (zero sales):** excluded from baseline and from
  lift computation (avoid −100% skew).
- **Year rollover:** December fires generate next year's calendar.
- **Proclaimed special non-working days mid-year:** weekly refresh re-asks AI;
  new days merged into the calendar doc.

## Testing

- **Unit:** lift math (baseline same-weekday window, holiday/zero exclusion,
  ≥2-sample threshold, EWMA); calendar + `dailyContext` override merge;
  enrichment-string builder (measured vs unmeasured).
- **Integration:** forecast input carries enriched holiday strings; prompt
  renders them.
- **Manual:** force-run the cron → verify `holidayCalendar/{YYYY}` and
  `holidayEffects/summary` docs → check a known-holiday week on `/dashboard`.

## Touched / new files (anticipated)

- New: `src/lib/holidays/holiday-calendar.ts` (types + slug + merge helpers),
  `src/ai/flows/generate-holiday-calendar.ts` (Genkit flow),
  `src/lib/server/holiday-calendar.ts` (per-store generation + due-store cron
  driver + run-log), `src/lib/server/holiday-effects.ts` (deterministic
  learning), `src/app/api/cron/holiday-calendar/route.ts`.
- Changed: `src/lib/server/generate-forecast.ts` (read calendar + effects,
  enrich `upcomingHolidays`), `src/ai/flows/forecast-weekly-sales.ts` (prompt
  Holidays rule), `src/lib/types.ts` (new types), cashier flow (remove
  `StartShiftModal` holiday gate), `docs/CRON.md` (new job).
