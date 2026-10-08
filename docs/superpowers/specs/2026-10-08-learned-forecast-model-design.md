# Learned Forecast Model — Design

Date: 2026-10-08 · Status: draft for review · Repo: POS

## 1. Why

A backtest on live data (2026-10-08, 445 store-days, Lipa / Malvar / Davao, Feb–Oct 2026) compared the
stored LLM `projectedSales` against simple same-weekday baselines (WAPE, lower is better):

| Slice | LLM | 4-wk same-weekday avg | 8-wk median × level |
|---|---|---|---|
| All days | 33.5% | 28.8% | 27.8% |
| Normal days (actual within 30% of avg) | 26.1% | 14.5% | – |
| Holiday / occasion days (n=21) | 29.7% | 38.7% | – |
| LLM-labelled "high" confidence | 41.9% | 25.2% | – |
| PM-rain days | 35.3% | 27.8% | – |

The LLM also over-forecasts by 4.9%. It only wins on holidays, which already
have measured per-store lifts in `holidayEffects`. Separately, every daily run re-reads about 110 Firestore docs
per store: 28 analytics docs, up to 28 weatherRecords, about 35 dailyContext docs, 14 for the accuracy backfill, plus calendars and weather months.

**Goal:** store what has been learned instead of re-deriving it every day. A per-store model doc holds
learned factors and the evidence behind them, nightly code updates it from each new day's actual, the daily
forecast is arithmetic over that doc, and Claude writes the plain-language reasoning weekly from the doc alone.

**Success:**
1. In shadow, model WAPE ≤ LLM WAPE per store over 14 days.
2. Daily reads per store drop from about 110 to about 17.
3. With engine = model, zero AI calls per daily forecast.

## 2. Model doc — `stores/{storeId}/forecastModel/current`

```ts
type FactorStat = {
  liftPct: number;        // applied effect, already shrunk (see §3.4)
  rawLogLift: number;     // EWMA of ln(actual / expected-without-this-factor)
  samples: number;
  evidence: { date: string; expected: number; actual: number; note?: string }[]; // last 10
};

type ForecastModel = {
  version: 1;
  storeId: string;
  processedThrough: string;             // YYYY-MM-DD, last day learned (Manila)
  updatedAtMs: number;
  weekday: Record<"0"|"1"|"2"|"3"|"4"|"5"|"6", {
    base: number;                       // EWMA of de-factored sales
    mad: number;                        // EWMA of |actual/expected - 1| (drives confidence)
    samples: number;
  }>;
  rain: FactorStat;                     // PM rain (see §3.3)
  payday: Record<PaydayCell, FactorStat>; // date × weekday cells (see §3.2)
  accuracy: {                           // rolling, EWMA-weighted sums (alpha 1/28)
    model: { absErr: number; actual: number; signedErr: number; n: number };
    llm:   { absErr: number; actual: number; signedErr: number; n: number };
  };
  reasoning: { summary: string; flags: string[]; generatedAt: number; provider: "claude" | "gemini" } | null;
};
```

Holidays are not duplicated here. The model reads the existing `holidayEffects/summary` (avgLiftPct, samples).

## 3. Learning rules (pure functions, `src/lib/forecast/model.ts`)

### 3.1 Multiplicative structure

`expected(day) = weekday[dow].base × Π (1 + factor.liftPct/100)` over the factors active that day.

To learn from day D, with actual `A > 0` (closed or zero days are skipped):

1. Compute `expected` with the model **as it stood before D**.
2. Update each active factor f with `ln(A / (expected / (1 + f.liftPct/100)))`, i.e. the actual vs. everything except f.
3. If D is not a holiday, update `weekday[dow].base` with the **de-factored** actual `A / Π(active factor multipliers)`,
   clipped to [0.5×, 2×] of the current base. α = 0.25, which is about an 8-week memory. The clipping is what made
   the median baseline robust in the backtest.
4. Update `weekday[dow].mad` with `|A/expected − 1|` (α = 0.25).
5. Holiday days (calendar or dailyContext override) skip steps 2–3. Holiday lifts stay owned by
   `recomputeHolidayEffectsForStore`.

### 3.2 Payday: date × weekday cells

Paydays are tied to calendar dates (e.g. the 10th and end of month, or 15th and EOM), but when the nominal date falls on a
weekend the salary is usually released the Friday before. The working assumption to test is that a Friday payday,
natural or shifted, lifts sales more than a Mon–Thu payday, because the weekend follows it.

- **Nominal dates** come from `forecastConfig`:
  - Add a schedule `semi_monthly_10_eom`.
  - `customPayrollDates` values above the month's length clamp to the last day, so 31 means EOM.
  - Fix: the current `new Date(year, m, 31)` overflows into the next month.
- **Effective payday** = nominal date, moved to the preceding Friday if it falls on Sat or Sun. This is the existing
  `adjustWeekend`, rewritten to work on YYYY-MM-DD strings so it no longer depends on the server's timezone.
- **Cell key** = `${offset}_${class}`:
  - `offset` ∈ {−1, 0, +1, +2}: days from the effective payday.
  - `class` ∈ {`fri` (effective payday is a Friday, natural or shifted), `wkday` (Mon–Thu)}.
  - That gives 8 cells.
  - Each evidence row notes `shifted from Sat 10th` when applicable, so the weekly reasoning can say whether shifted
    Fridays behave differently from natural ones. They are not split into separate cells yet, because the data is too thin (§7).
- A staff-confirmed `dailyContext.isPayday` on a day with no computed payday creates an `offset 0` hit for that day.
- Only one payday window applies per day; if two overlap, the nearest effective payday wins.

### 3.3 Rain

- Active when the day's logged `weatherForecasts` entry has a `pm` (or whole-day `condition`) matching
  `/rain|storm|thunder/i`.
- For forecasting, it also requires `pop ≥ 0.6`, or a heavy-rain or storm condition.
- Days with no logged weather never update the rain factor.

### 3.4 Shrinkage

- Thin factors shouldn't swing forecasts: `liftPct = (exp(rawLogLift) − 1) × 100 × samples / (samples + 3)`.
- Payday cells additionally shrink toward their offset's pooled estimate across both classes. Each pooled estimate is
  kept as an extra entry `payday[`${offset}_all`]`.
- So a cell with 1 sample mostly uses the pooled offset effect, and moves to its own value as samples grow.
- EWMA α for factors is 0.2.

### 3.5 Confidence

From the weekday `mad`:

| `mad` | Label |
|---|---|
| < 12% | high |
| < 25% | medium |
| otherwise | low |

Drop one level when the day has an unmeasured holiday, or an active factor with fewer than 3 samples.

## 4. Jobs

### 4.1 Nightly learner — inside `update-accuracy` cron

For each store:

1. Read the model doc. If it's missing or `version` has changed, **bootstrap**: replay the last 90 days in order,
   which is about 90 analytics reads, once.
2. For each day from `processedThrough + 1` to yesterday, read the analytics doc plus the weather month, holiday calendar,
   and dailyContext for that day, then apply §3.
   - Normally that's one day, about 5 reads.
   - The run is idempotent, and catches up missed nights.
3. Fold in accuracy for both engines.
   - This replaces `backfillRecentAccuracy`, which re-read 14 docs a day.
   - It writes `actualSales`, `accuracy` and `modelAccuracy` on the forecast doc.
4. Write the model doc once per store.

### 4.2 Daily forecast — `generateForecastForStore`

1. Read the model doc, the weather months covering the next 7 days, the holiday calendar(s), `holidayEffects/summary`,
   and dailyContext for the next 7 days. That's about 12 reads.
2. For each of the 7 days, compute `modelSales`, the `confidence` from §3.5, and `drivers: string[]`, e.g.
   `["Sat baseline ₱48,200", "payday +11% (Fri payday, 6 days)", "PM rain −9% (14 days)"]`.
   The drivers are the stored reasoning behind that day's number.
3. The engine comes from `forecastConfig.engine` (`"llm"` by default, or `"model"`):
   - `llm` (shadow): run the existing LLM path unchanged, then write `projectedSales` (LLM) **plus**
     `modelSales` and `drivers`.
   - `model`: skip every history read and the LLM call, and write `projectedSales = modelSales` plus `drivers`.
4. Write `engine` and `provider` on every forecast doc, so accuracy can always be attributed.

### 4.3 Weekly reasoning — Sundays, inside the learner run

- Send the model doc JSON only (no raw history) to Claude through `src/ai/claude.ts`, using a new `explainForecastModel()`,
  with structured output `{ summary: string (≤ 120 words), flags: string[] (≤ 5) }`.
- Gemini is the fallback, same pattern as the daily forecast.
- Store the result in `reasoning`.
- Flags are observations, e.g.
  - "Friday paydays lift +18% vs +6% midweek — matches the early-salary assumption"
  - "Malvar Friday baseline unstable (mad 31%)"
  - "rain effect based on only 4 days"
- The AI never writes numbers back into the model.

## 5. UI

- **`ForecastAccuracyCard`:** show model vs LLM WAPE and bias from `forecastModel.accuracy`, plus the reasoning summary and flags.
- **Store settings → forecast:**
  - Add an engine toggle (LLM / Model), with both WAPEs shown next to it.
  - Add the `semi_monthly_10_eom` payroll option.
  - Add the note "31 = end of month" for custom dates.
- **Forecast day tooltip:** wherever a projected day is shown today, show `drivers`.

## 6. Rollout

1. **Replay check, before shipping shadow.** `scripts/forecast-model-replay.ts` runs the learner over the full history,
   forecasting each day before learning from it, the same horizon as today's stored projection. It prints WAPE and bias
   per store vs the stored LLM and the 4-wk average. Proceed if model ≤ LLM overall; report it either way.
2. **Shadow for 14 days.** All stores stay on `engine: "llm"`, and both numbers are recorded.
3. **Switch per store, manually.** Ian switches each store's engine in store settings. There is no automatic switch.

## 7. Out of scope (deliberate)

- **Temperature and non-rain weather:** no evidence of an effect yet. Add it once a learned factor shows one.
- **Separate trend/level factor:** the weekday EWMA already tracks level, and the backtest showed level adjustment
  adds about 1 point.
- **Splitting shifted vs natural Friday paydays into separate cells:** at 2 paydays a month, each store has about 15
  paydays so far, spread over 8 cells. The evidence notes keep the distinction visible to the weekly reasoning, so it
  can be promoted to its own cell once samples allow.
- **Python/ML service, ETS libraries:** not justified at 3 stores with about 200 days each. Revisit only if the model plateaus.
- **Automatic engine switching:** this stays a human decision.
- **Holiday calendar generation:** unchanged. It is still the Gemini flow.

## 8. Testing

- **Unit tests (vitest) for the pure functions in `src/lib/forecast/model.ts`:**
  - effective-payday shifting, including Sat 10th → Fri 9th, Sun EOM → Fri, and February EOM
  - cell assignment and overlap resolution
  - the shrinkage maths
  - de-factored base updates and clipping
  - holiday days skipping baseline updates
  - idempotent re-learning of an already-processed day
- **Replay script:** see §6.1. It is the acceptance gate.
- **Shadow comparison:** reported by the accuracy card. It is the switch gate.

## 9. Files

| File | Change |
|---|---|
| `src/lib/forecast/model.ts` (new) | Pure: payday calendar, cells, learn-day, forecast-day, shrinkage, confidence |
| `src/lib/forecast/model.test.ts` (new) | Unit tests |
| `src/lib/server/forecast-model.ts` (new) | Firestore I/O: load/bootstrap/learn/save, weekly reasoning |
| `src/lib/server/generate-forecast.ts` | Engine switch, write `modelSales`/`drivers`/`engine`/`provider`, remove `backfillRecentAccuracy` |
| `src/ai/claude.ts` | Add `explainForecastModel()` |
| `src/lib/utils/forecast-helpers.ts` | String-based payday dates, `semi_monthly_10_eom`, EOM clamp |
| `src/lib/types.ts` | `ForecastConfig.engine`, new schedule type, `ForecastModel` |
| `src/components/dashboard/ForecastAccuracyCard.tsx` | Model vs LLM, reasoning |
| `src/components/manager/store-settings/forecast-settings.tsx` | Engine toggle, payroll option |
| `scripts/forecast-model-replay.ts` (new) | Acceptance replay |
| `firestore.rules` | `forecastModel` readable by store managers, server-write only |
