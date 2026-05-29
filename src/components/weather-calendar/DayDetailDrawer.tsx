"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, PartyPopper, Wallet, CalendarHeart } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { KNOWN_HOLIDAYS } from "@/lib/holidays/known-holidays";
import { getCalendarWeatherIcon, isNightHour } from "@/lib/weather/icons";
import { toJsDate } from "@/lib/utils/date";
import type { DailyMetric } from "@/lib/types";
import type { DayCellData } from "./WeatherCalendarGrid";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  storeId: string;
  cell: DayCellData;
  dailyMetric: DailyMetric | null;
  /** Called with the new cashier-holiday name (or "None" on unmark) so the parent can refresh its map. */
  onChanged: (name: string | null) => void;
}

const fmtMoney = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDateLong(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export function DayDetailDrawer({ open, onOpenChange, storeId, cell, dailyMetric, onChanged }: Props) {
  const { toast } = useToast();
  const { appUser } = useAuthContext();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
  }, [open, cell.dayId]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return KNOWN_HOLIDAYS.slice(0, 8);
    return KNOWN_HOLIDAYS.filter(h => h.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  const sortedEntries = useMemo(() => {
    return [...cell.weatherEntries]
      .map(e => ({ e, t: toJsDate(e.timestamp)?.getTime() ?? 0 }))
      .filter(x => x.t > 0)
      .sort((a, b) => a.t - b.t)
      .map(x => x.e);
  }, [cell.weatherEntries]);

  const netSales = cell.netSales;
  const txCount = dailyMetric?.payments?.txCount ?? 0;
  const avgBasket = txCount > 0 ? netSales / txCount : 0;

  const writeHoliday = async (name: string) => {
    if (!appUser) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, "stores", storeId, "dailyContext", cell.dayId),
        {
          dayId: cell.dayId,
          holiday: {
            name,
            loggedByUid: appUser.uid,
            loggedAt: Timestamp.now(),
          },
        },
        { merge: true },
      );
      onChanged(name === "None" ? null : name);
      toast({ title: name === "None" ? "Unmarked" : "Marked as holiday", description: name === "None" ? cell.dayId : name });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Save failed", description: err?.message || "Could not update." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{fmtDateLong(cell.date)}</DialogTitle>
          <DialogDescription>Weather, sales, and holiday details for this day.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Holiday block */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <PartyPopper className="h-3.5 w-3.5" /> Holiday
            </div>
            {cell.presetHoliday && (
              <div className="flex items-center gap-2 text-sm">
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  Preset
                </span>
                <span>{cell.presetHoliday}</span>
              </div>
            )}
            {cell.cashierHoliday ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm min-w-0">
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    <CalendarHeart className="h-2.5 w-2.5" /> Cashier
                  </span>
                  <span className="truncate">{cell.cashierHoliday}</span>
                </div>
                <Button variant="ghost" size="sm" disabled={saving} onClick={() => writeHoliday("None")}>
                  Unmark
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Type or pick a holiday name…"
                  disabled={saving}
                />
                <div className="flex flex-wrap gap-1">
                  {suggestions.map(name => (
                    <Button
                      key={name}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={saving}
                      onClick={() => writeHoliday(name)}
                    >
                      {name}
                    </Button>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  disabled={saving || !query.trim()}
                  onClick={() => writeHoliday(query.trim())}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  Mark "{query.trim() || "…"}" as holiday
                </Button>
              </div>
            )}
          </div>

          {/* Sales block */}
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1.5">
              <Wallet className="h-3.5 w-3.5" /> Sales
            </div>
            {netSales > 0 ? (
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Net</div>
                  <div className="font-semibold tabular-nums">₱{fmtMoney(netSales)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tx</div>
                  <div className="font-semibold tabular-nums">{txCount.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg basket</div>
                  <div className="font-semibold tabular-nums">{avgBasket > 0 ? `₱${fmtMoney(avgBasket)}` : "—"}</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No sales recorded.</p>
            )}
          </div>

          {/* Weather log */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs text-muted-foreground">Weather log ({sortedEntries.length})</div>
            {sortedEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No weather logged this day.</p>
            ) : (
              <ul className="space-y-1.5">
                {sortedEntries.map((e, i) => {
                  const ts = toJsDate(e.timestamp);
                  const atNight = ts ? isNightHour(ts.getHours()) : false;
                  const meta = getCalendarWeatherIcon(e.condition, atNight);
                  const Icon = meta.icon;
                  return (
                    <li key={i} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5">
                      <span className={`h-7 w-7 rounded-md bg-gradient-to-br ${meta.gradient} flex items-center justify-center shrink-0`}>
                        <Icon className={`h-4 w-4 ${meta.iconColor}`} strokeWidth={1.8} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">{meta.label}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {ts ? ts.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—"}
                          {e.loggedByProfileName ? ` · ${e.loggedByProfileName}` : ""}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
