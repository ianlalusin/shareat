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
const pct = (p: number) => {
  // Clean up floating point noise before rounding away from zero
  const cleaned = Math.round(p * 1e10) / 1e10;
  const rounded = cleaned >= 0 ? Math.floor(cleaned + 0.5) : Math.ceil(cleaned - 0.5);
  return `${p >= 0 ? "+" : "−"}${Math.abs(rounded)}%`;
};
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
