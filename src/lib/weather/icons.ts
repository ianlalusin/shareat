import { Sun, Cloudy, CloudRain, CloudLightning, Moon } from "lucide-react";
import type { WeatherCondition } from "@/lib/types";

export type WeatherIconMeta = {
  label: string;
  icon: React.ElementType;
  gradient: string;
  iconColor: string;
};

const DAY_ICONS: Record<WeatherCondition, WeatherIconMeta> = {
  sunny: { label: "Sunny", icon: Sun, gradient: "from-amber-400 to-orange-500", iconColor: "text-white" },
  cloudy: { label: "Cloudy", icon: Cloudy, gradient: "from-slate-300 to-slate-500", iconColor: "text-white" },
  light_rain: { label: "Light Rain", icon: CloudRain, gradient: "from-sky-400 to-blue-600", iconColor: "text-white" },
  heavy_rain: { label: "Heavy Rain", icon: CloudLightning, gradient: "from-indigo-500 to-purple-700", iconColor: "text-white" },
};

const NIGHT_SUNNY_OVERRIDE: WeatherIconMeta = {
  label: "Clear",
  icon: Moon,
  gradient: "from-indigo-900 to-slate-800",
  iconColor: "text-amber-300",
};

export function isNightHour(hour: number): boolean {
  return hour >= 18 || hour < 6;
}

/** Resolve a condition to its display meta, optionally swapping sunny→clear at night. */
export function getWeatherIcon(condition: WeatherCondition, atNight = false): WeatherIconMeta {
  if (atNight && condition === "sunny") return NIGHT_SUNNY_OVERRIDE;
  return DAY_ICONS[condition];
}

/** All condition tiles, with the night override applied to sunny when needed. */
export function getWeatherOptions(atNight = false): Array<WeatherIconMeta & { value: WeatherCondition }> {
  return (Object.keys(DAY_ICONS) as WeatherCondition[]).map((value) => ({
    value,
    ...getWeatherIcon(value, atNight),
  }));
}
