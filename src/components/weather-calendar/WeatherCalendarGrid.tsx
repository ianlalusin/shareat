"use client";

import { useMemo } from "react";
import { PartyPopper, CalendarHeart } from "lucide-react";
import type { WeatherEntry } from "@/lib/types";
import { getCalendarWeatherIcon, isNightHour } from "@/lib/weather/icons";
import { toJsDate } from "@/lib/utils/date";

export type DayCellData = {
  date: Date;
  dayId: string;
  isInMonth: boolean;
  weatherEntries: WeatherEntry[];
  netSales: number;
  salesColor: "red" | "amber" | "green" | "muted";
  cashierHoliday: string | null;
  presetHoliday: string | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SALES_COLOR_CLASS: Record<DayCellData["salesColor"], string> = {
  red: "text-red-600 font-semibold",
  amber: "text-amber-600 font-medium",
  green: "text-green-600 font-semibold",
  muted: "text-muted-foreground",
};

const compactPHP = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function isToday(d: Date): boolean {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/** Up to 5 entries, sorted by timestamp ascending. If more than 5, sample 5 evenly. */
function pickFiveEntries(entries: WeatherEntry[]): WeatherEntry[] {
  const sorted = entries
    .map(e => ({ e, t: toJsDate(e.timestamp)?.getTime() ?? 0 }))
    .filter(x => x.t > 0)
    .sort((a, b) => a.t - b.t)
    .map(x => x.e);
  if (sorted.length <= 5) return sorted;
  const out: WeatherEntry[] = [];
  for (let i = 0; i < 5; i++) {
    const idx = Math.round((i * (sorted.length - 1)) / 4);
    out.push(sorted[idx]);
  }
  return out;
}

function DayCell({ cell, onClick }: { cell: DayCellData; onClick: () => void }) {
  const today = isToday(cell.date);
  const displayed = useMemo(() => pickFiveEntries(cell.weatherEntries), [cell.weatherEntries]);

  const holidayName = cell.cashierHoliday || cell.presetHoliday;
  const holidaySource = cell.cashierHoliday ? "cashier" : cell.presetHoliday ? "preset" : null;

  return (
    <button
      type="button"
      onClick={onClick}
      title={holidayName ? `${holidayName} (${holidaySource})` : undefined}
      className={`group relative aspect-square sm:aspect-auto sm:min-h-[112px] rounded-lg border bg-card p-1.5 sm:p-2 text-left flex flex-col gap-1 transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${cell.isInMonth ? "" : "opacity-40"} ${today ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className={`text-xs sm:text-sm tabular-nums ${today ? "text-primary font-semibold" : "text-foreground"}`}>
          {cell.date.getDate()}
        </span>
        {holidayName && (
          <span
            className={`hidden sm:inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded font-medium truncate max-w-[80%] ${
              holidaySource === "cashier"
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
          >
            {holidaySource === "cashier" ? <CalendarHeart className="h-2.5 w-2.5" /> : <PartyPopper className="h-2.5 w-2.5" />}
            <span className="truncate">{holidayName}</span>
          </span>
        )}
        {holidayName && (
          <span
            className={`sm:hidden h-2 w-2 rounded-full shrink-0 ${holidaySource === "cashier" ? "bg-indigo-500" : "bg-amber-500"}`}
            aria-label={holidayName}
          />
        )}
      </div>

      <div className="flex-1 flex flex-wrap items-center gap-0.5 sm:gap-1 content-center">
        {displayed.map((e, i) => {
          const ts = toJsDate(e.timestamp);
          const atNight = ts ? isNightHour(ts.getHours()) : false;
          const meta = getCalendarWeatherIcon(e.condition, atNight);
          const Icon = meta.icon;
          return (
            <span
              key={i}
              className={`h-4 w-4 sm:h-5 sm:w-5 rounded-md bg-gradient-to-br ${meta.gradient} flex items-center justify-center shrink-0`}
              title={`${meta.label}${ts ? ` · ${ts.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}`}
            >
              <Icon className={`h-2.5 w-2.5 sm:h-3 sm:w-3 ${meta.iconColor}`} strokeWidth={2} />
            </span>
          );
        })}
      </div>

      <div className={`text-[11px] sm:text-xs tabular-nums ${SALES_COLOR_CLASS[cell.salesColor]}`}>
        {cell.netSales > 0 ? `₱${compactPHP.format(cell.netSales)}` : "—"}
      </div>
    </button>
  );
}

export function WeatherCalendarGrid({ cells, onCellClick }: { cells: DayCellData[]; onCellClick: (dayId: string) => void }) {
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-1.5 text-center text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {WEEKDAYS.map(w => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {cells.map(c => <DayCell key={c.dayId} cell={c} onClick={() => onCellClick(c.dayId)} />)}
      </div>
    </div>
  );
}
