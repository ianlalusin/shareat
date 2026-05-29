"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Loader2 } from "lucide-react";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { getPresetHolidayName } from "@/lib/holidays/ph-regular-holidays";
import type { DailyContext, DailyMetric, WeatherEntry, WeatherRecord } from "@/lib/types";
import { WeatherCalendarGrid, type DayCellData } from "./WeatherCalendarGrid";
import { DayDetailDrawer } from "./DayDetailDrawer";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** 42-cell grid: from the Sunday on/before the 1st, 41 days forward. */
function build42(monthCursor: Date): Date[] {
  const first = startOfMonth(monthCursor);
  const dow = first.getDay(); // 0=Sun
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - dow);
  const out: Date[] = [];
  for (let i = 0; i < 42; i++) {
    out.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return out;
}

function netSalesOf(metric?: DailyMetric): number {
  if (!metric) return 0;
  const p = metric.payments;
  if (!p) return 0;
  return Math.max(0, (p.totalGross || 0) - (p.discountsTotal || 0) - (p.chargesTotal || 0));
}

type ColorBucket = "red" | "amber" | "green" | "muted";

function pickColor(net: number, lo: number, hi: number, fewSamples: boolean): ColorBucket {
  if (net <= 0) return "muted";
  if (fewSamples) return "amber";
  if (net <= lo) return "red";
  if (net <= hi) return "amber";
  return "green";
}

export function WeatherCalendarPageClient() {
  const router = useRouter();
  const { activeStore } = useStoreContext();
  const [monthCursor, setMonthCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [isLoading, setIsLoading] = useState(true);
  const [weatherByDayId, setWeatherByDayId] = useState<Record<string, WeatherEntry[]>>({});
  const [metricByDayId, setMetricByDayId] = useState<Record<string, DailyMetric>>({});
  const [cashierHolidayByDayId, setCashierHolidayByDayId] = useState<Record<string, string>>({});
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);

  const cells = useMemo(() => build42(monthCursor), [monthCursor]);
  const cellDayIds = useMemo(() => cells.map(d => getDayIdFromTimestamp(d)), [cells]);

  useEffect(() => {
    const storeId = activeStore?.id;
    if (!storeId) return;
    let cancelled = false;
    setIsLoading(true);

    (async () => {
      const startMs = cells[0].getTime();
      const endMs = new Date(cells[41].getFullYear(), cells[41].getMonth(), cells[41].getDate() + 1).getTime();

      try {
        const [weatherSnaps, metricSnap, contextSnaps] = await Promise.all([
          Promise.all(cellDayIds.map(id => getDoc(doc(db, "stores", storeId, "weatherRecords", id)))),
          getDocs(query(
            collection(db, "stores", storeId, "analytics"),
            where("meta.dayStartMs", ">=", startMs),
            where("meta.dayStartMs", "<", endMs),
          )),
          Promise.all(cellDayIds.map(id => getDoc(doc(db, "stores", storeId, "dailyContext", id)))),
        ]);
        if (cancelled) return;

        const weather: Record<string, WeatherEntry[]> = {};
        weatherSnaps.forEach((snap, i) => {
          if (snap.exists()) {
            const r = snap.data() as WeatherRecord;
            weather[cellDayIds[i]] = Array.isArray(r.entries) ? r.entries : [];
          }
        });

        const metrics: Record<string, DailyMetric> = {};
        metricSnap.docs.forEach(d => { metrics[d.id] = d.data() as DailyMetric; });

        const cashHol: Record<string, string> = {};
        contextSnaps.forEach((snap, i) => {
          if (!snap.exists()) return;
          const ctx = snap.data() as DailyContext;
          const name = ctx.holiday?.name?.trim();
          if (name && name !== "None") cashHol[cellDayIds[i]] = name;
        });

        setWeatherByDayId(weather);
        setMetricByDayId(metrics);
        setCashierHolidayByDayId(cashHol);
      } catch (err) {
        console.error("[WeatherCalendar] load failed", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [activeStore?.id, cellDayIds, cells]);

  // Per-month tertile color thresholds, computed from in-month days only.
  const inMonthValues = useMemo(() => {
    const m = monthCursor.getMonth();
    const y = monthCursor.getFullYear();
    return cells
      .map((d, i) => ({ d, dayId: cellDayIds[i] }))
      .filter(({ d }) => d.getMonth() === m && d.getFullYear() === y)
      .map(({ dayId }) => netSalesOf(metricByDayId[dayId]))
      .filter(v => v > 0)
      .sort((a, b) => a - b);
  }, [cells, cellDayIds, metricByDayId, monthCursor]);

  const colorThresholds = useMemo(() => {
    const n = inMonthValues.length;
    if (n < 3) return { lo: 0, hi: 0, fewSamples: true };
    return {
      lo: inMonthValues[Math.floor(n / 3)],
      hi: inMonthValues[Math.floor((n * 2) / 3)],
      fewSamples: false,
    };
  }, [inMonthValues]);

  const dayCells: DayCellData[] = useMemo(() => {
    const curM = monthCursor.getMonth();
    const curY = monthCursor.getFullYear();
    return cells.map((d, i) => {
      const dayId = cellDayIds[i];
      const isInMonth = d.getMonth() === curM && d.getFullYear() === curY;
      const net = netSalesOf(metricByDayId[dayId]);
      const presetHoliday = getPresetHolidayName(dayId);
      const cashierHoliday = cashierHolidayByDayId[dayId] ?? null;
      return {
        date: d,
        dayId,
        isInMonth,
        weatherEntries: weatherByDayId[dayId] ?? [],
        netSales: net,
        salesColor: pickColor(net, colorThresholds.lo, colorThresholds.hi, colorThresholds.fewSamples),
        cashierHoliday,
        presetHoliday,
      };
    });
  }, [cells, cellDayIds, weatherByDayId, metricByDayId, cashierHolidayByDayId, colorThresholds, monthCursor]);

  const selectedCell = useMemo(
    () => (selectedDayId ? dayCells.find(c => c.dayId === selectedDayId) ?? null : null),
    [selectedDayId, dayCells],
  );

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      <PageHeader title="Weather & Sales Calendar" description={activeStore?.name}>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </PageHeader>

      <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonthCursor(c => addMonths(c, -1))} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-lg font-semibold tabular-nums px-2">
            {MONTH_LABELS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
          </div>
          <Button variant="outline" size="icon" onClick={() => setMonthCursor(c => addMonths(c, 1))} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setMonthCursor(startOfMonth(new Date()))}>
          <CalendarIcon className="mr-1.5 h-4 w-4" /> Today
        </Button>
      </div>

      <div className="relative mt-3">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 rounded-lg">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <WeatherCalendarGrid
          cells={dayCells}
          onCellClick={(dayId) => setSelectedDayId(dayId)}
        />
      </div>

      <div className="mt-4 flex items-center justify-end gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Low</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Mid</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-600" /> High</span>
      </div>

      {selectedCell && activeStore && (
        <DayDetailDrawer
          open={!!selectedCell}
          onOpenChange={(v) => { if (!v) setSelectedDayId(null); }}
          storeId={activeStore.id}
          cell={selectedCell}
          dailyMetric={metricByDayId[selectedCell.dayId] ?? null}
          onChanged={(name) => {
            setCashierHolidayByDayId(prev => {
              const next = { ...prev };
              if (name && name !== "None") next[selectedCell.dayId] = name;
              else delete next[selectedCell.dayId];
              return next;
            });
          }}
        />
      )}
    </RoleGuard>
  );
}
