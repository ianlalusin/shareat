"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent } from "@/components/ui/card";
import { ShoppingBasket, Target } from "lucide-react";

interface Props {
  storeId: string;
}

function fmtPeso(n: number): string {
  if (n >= 1_000_000) return `₱${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₱${(n / 1_000).toFixed(1)}k`;
  return `₱${Math.round(n).toLocaleString()}`;
}

function getTodayDayId(): string {
  const manila = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const y = manila.getFullYear();
  const m = String(manila.getMonth() + 1).padStart(2, "0");
  const d = String(manila.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function getTodayDate(): string {
  const manila = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const y = manila.getFullYear();
  const m = String(manila.getMonth() + 1).padStart(2, "0");
  const d = String(manila.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function CashierSummaryCard({ storeId }: Props) {
  const [avgBasket, setAvgBasket] = useState<number | null>(null);
  const [forecastedSales, setForecastedSales] = useState<number | null>(null);
  const [targetSales, setTargetSales] = useState<number | null>(null);

  // Today's analytics (live) — gives us avgBasket
  useEffect(() => {
    if (!storeId) return;
    const dayId = getTodayDayId();
    const ref = doc(db, "stores", storeId, "analytics", dayId);
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      const netSales = Number(data?.payments?.totalGross ?? 0);
      const tx = Number(data?.payments?.txCount ?? 0);
      if (tx > 0) setAvgBasket(netSales / tx);
      else setAvgBasket(0);
    });
  }, [storeId]);

  // Today's forecast (live)
  useEffect(() => {
    if (!storeId) return;
    const today = getTodayDate();
    const ref = doc(db, "stores", storeId, "salesForecasts", today);
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      setForecastedSales(data?.projectedSales ?? null);
    });
  }, [storeId]);

  // Today's manager target override (live)
  useEffect(() => {
    if (!storeId) return;
    const today = getTodayDate();
    const ref = doc(db, "stores", storeId, "salesTargets", today);
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      const amt = Number(data?.amount ?? 0);
      setTargetSales(amt > 0 ? amt : null);
    });
  }, [storeId]);

  const displayTarget = targetSales ?? forecastedSales ?? null;
  const targetLabel = targetSales != null ? "TARGET" : "FORECAST";

  return (
    <Card className="h-auto">
      <CardContent className="p-2 px-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <ShoppingBasket className="h-4 w-4 text-muted-foreground" />
          <div className="leading-tight">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Avg basket</p>
            <p className="text-sm font-bold tabular-nums">
              {avgBasket == null ? "—" : fmtPeso(avgBasket)}
            </p>
          </div>
        </div>
        <div className="h-8 w-px bg-border" />
        <div className="flex items-center gap-2">
          <Target className={`h-4 w-4 ${targetSales != null ? "text-primary" : "text-muted-foreground"}`} />
          <div className="leading-tight">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{targetLabel} today</p>
            <p className={`text-sm font-bold tabular-nums ${targetSales != null ? "text-primary" : ""}`}>
              {displayTarget == null ? "—" : fmtPeso(displayTarget)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
