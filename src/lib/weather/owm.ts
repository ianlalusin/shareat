import type { WeatherCondition } from "@/lib/types";

// OpenWeatherMap 5-day / 3-hour forecast — free tier.
// https://openweathermap.org/forecast5

const OWM_FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast";

export type OwmSlot = {
  dt: number; // unix seconds (UTC)
  main?: { temp?: number };
  weather?: Array<{ id?: number; main?: string; description?: string }>;
  rain?: { "3h"?: number };
  pop?: number; // 0..1
};

/** Fetch the raw 3-hourly forecast slots (~40 entries, 5 days) for a lat/lng. */
export async function fetchOwmForecast(lat: number, lng: number): Promise<OwmSlot[]> {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) throw new Error("OPENWEATHER_API_KEY not set");
  const url = `${OWM_FORECAST_URL}?lat=${lat}&lon=${lng}&units=metric&appid=${key}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OWM forecast ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { list?: OwmSlot[] };
  return Array.isArray(json.list) ? json.list : [];
}

/**
 * Map an OpenWeatherMap condition id to this app's 4-value enum.
 * Ranges: 2xx thunderstorm, 3xx drizzle, 5xx rain, 6xx snow, 7xx atmosphere,
 * 800 clear, 80x clouds. See https://openweathermap.org/weather-conditions
 */
export function mapOwmIdToCondition(id: number | undefined): WeatherCondition {
  if (id == null) return "cloudy";
  if (id >= 200 && id < 300) return "heavy_rain"; // thunderstorm
  if (id >= 300 && id < 400) return "light_rain"; // drizzle
  if (id >= 500 && id < 600) {
    // light/moderate/showers → light_rain; heavy/very heavy/freezing → heavy_rain
    return id === 500 || id === 501 || id === 520 || id === 521 ? "light_rain" : "heavy_rain";
  }
  if (id >= 600 && id < 800) return "cloudy"; // snow (n/a) + mist/fog/haze
  if (id === 800 || id === 801) return "sunny"; // clear / few clouds
  return "cloudy"; // 802-804 scattered/broken/overcast
}

// Worst-rain-wins ordering so a rainy block isn't hidden by sunny averages.
const SEVERITY: Record<WeatherCondition, number> = { sunny: 0, cloudy: 1, light_rain: 2, heavy_rain: 3 };

/** Manila (UTC+8, no DST) day id (YYYYMMDD) + hour for a unix-seconds timestamp. */
function manilaDayParts(dtSeconds: number): { dayId: string; date: string; hour: number } {
  const d = new Date((dtSeconds + 8 * 3600) * 1000); // shift to Manila, read UTC getters
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return { dayId: `${y}${m}${day}`, date: `${y}-${m}-${day}`, hour: d.getUTCHours() };
}

export type DaySummary = {
  dayId: string;
  date: string;
  condition: WeatherCondition; // whole-day summary
  am: WeatherCondition;        // 00:00–12:00 (Manila)
  pm: WeatherCondition;        // 12:00–24:00 (Manila)
  tempC: number | null;
  pop: number | null;
  owmMain: string | null;
};

/** Worst-rain-wins condition across a set of slots (sunny if empty). */
function worstCond(slots: OwmSlot[]): WeatherCondition {
  let worst: WeatherCondition = "sunny";
  for (const s of slots) {
    const c = mapOwmIdToCondition(s.weather?.[0]?.id);
    if (SEVERITY[c] >= SEVERITY[worst]) worst = c;
  }
  return worst;
}

/**
 * Collapse 3-hourly slots into one summary per Manila day. The whole-day
 * condition uses worst-rain precedence across store hours (08:00–22:00); `am`
 * and `pm` summarise the two 12-hour windows; temp is the daytime average and
 * pop the daytime max.
 */
export function summarizeDays(slots: OwmSlot[]): DaySummary[] {
  const byDay = new Map<string, { date: string; day: OwmSlot[]; all: OwmSlot[]; am: OwmSlot[]; pm: OwmSlot[] }>();
  for (const s of slots) {
    const { dayId, date, hour } = manilaDayParts(s.dt);
    if (!byDay.has(dayId)) byDay.set(dayId, { date, day: [], all: [], am: [], pm: [] });
    const b = byDay.get(dayId)!;
    b.all.push(s);
    if (hour >= 8 && hour < 22) b.day.push(s);
    (hour < 12 ? b.am : b.pm).push(s);
  }

  const out: DaySummary[] = [];
  for (const [dayId, { date, day, all, am, pm }] of byDay) {
    const slotsForDay = day.length > 0 ? day : all;
    let worst: WeatherCondition = "sunny";
    let owmMain: string | null = null;
    let tempSum = 0, tempN = 0, popMax = 0;
    for (const s of slotsForDay) {
      const w = s.weather?.[0];
      const cond = mapOwmIdToCondition(w?.id);
      if (SEVERITY[cond] >= SEVERITY[worst]) { worst = cond; owmMain = w?.main ?? owmMain; }
      if (typeof s.main?.temp === "number") { tempSum += s.main.temp; tempN++; }
      if (typeof s.pop === "number") popMax = Math.max(popMax, s.pop);
    }
    out.push({
      dayId, date, condition: worst,
      am: am.length ? worstCond(am) : worst,
      pm: pm.length ? worstCond(pm) : worst,
      tempC: tempN > 0 ? Math.round((tempSum / tempN) * 10) / 10 : null,
      pop: popMax || null,
      owmMain,
    });
  }
  return out.sort((a, b) => a.dayId.localeCompare(b.dayId));
}
