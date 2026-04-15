"use client";

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { CashierTipModal } from "./CashierTipModal";
import { pickTip, currentMilestone, type Milestone } from "@/lib/cashier/tips";

interface Props {
  storeId: string;
}

const IDLE_MS = 5 * 60_000; // 5 minutes
const RECENT_DEPTH = 3;

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

/**
 * Idle-driven cashier tip nudges. Owns its own subscriptions to compute
 * percent-of-target so tips can prefer milestones when one is freshly
 * crossed.
 *
 * One tip per idle period: once shown, no further tips until the user
 * interacts with the page again. Activity → 5 min idle → next tip.
 */
export function CashierTipController({ storeId }: Props) {
  const [actualSales, setActualSales] = useState<number>(0);
  const [forecastedSales, setForecastedSales] = useState<number | null>(null);
  const [targetSales, setTargetSales] = useState<number | null>(null);

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [lastMilestone, setLastMilestone] = useState<Milestone>(0);
  const [recentlyShown, setRecentlyShown] = useState<string[]>([]);
  const [tipShownThisIdle, setTipShownThisIdle] = useState(false);
  const prevActivityRef = useRef<number>(0);
  const milestoneInitRef = useRef(false);

  const { isIdle, lastActivityAt } = useIdleTimer({ idleMs: IDLE_MS });

  // Reset the "shown" flag whenever new activity happens after a tip ran.
  useEffect(() => {
    if (lastActivityAt > prevActivityRef.current && tipShownThisIdle && !open) {
      setTipShownThisIdle(false);
    }
    prevActivityRef.current = lastActivityAt;
  }, [lastActivityAt, tipShownThisIdle, open]);

  // Live data subscriptions — same shapes as CashierTargetProgressCard.
  useEffect(() => {
    if (!storeId) return;
    const ref = doc(db, "stores", storeId, "analytics", getTodayDayId());
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      setActualSales(Number(data?.payments?.totalGross ?? 0));
    });
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    const ref = doc(db, "stores", storeId, "salesForecasts", getTodayDate());
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      setForecastedSales(data?.projectedSales ?? null);
    });
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    const ref = doc(db, "stores", storeId, "salesTargets", getTodayDate());
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      const amt = Number(data?.amount ?? 0);
      setTargetSales(amt > 0 ? amt : null);
    });
  }, [storeId]);

  const goal = targetSales ?? forecastedSales ?? 0;
  const percent = goal > 0 ? (actualSales / goal) * 100 : 0;

  // On first load, catch up lastMilestone silently so we don't re-celebrate
  // a milestone that was already crossed before the page opened. Only true
  // crossings (subsequent ticks) will trigger the celebratory tip.
  useEffect(() => {
    if (milestoneInitRef.current) return;
    if (goal <= 0) return; // wait until we have a real target/forecast
    milestoneInitRef.current = true;
    const cur = currentMilestone(percent);
    if (cur > 0) setLastMilestone(cur);
  }, [goal, percent]);

  // Independent watcher: as actual crosses a fresh milestone, immediately
  // surface a tip even if the cashier is mid-action — these are celebratory
  // and time-sensitive. Idle path covers behavior nudges.
  useEffect(() => {
    if (open || !milestoneInitRef.current) return;
    const cur = currentMilestone(percent);
    if (cur > lastMilestone && cur !== 0) {
      const result = pickTip({ percent, lastMilestone, recentlyShown });
      setMessage(result.message);
      if (result.milestone) setLastMilestone(result.milestone);
      setRecentlyShown((prev) => [result.message, ...prev].slice(0, RECENT_DEPTH));
      setOpen(true);
      setTipShownThisIdle(true);
    }
  }, [percent, lastMilestone, recentlyShown, open]);

  // Idle path — fire one behavior tip after IDLE_MS, no stacking.
  useEffect(() => {
    if (!isIdle || tipShownThisIdle || open) return;
    const result = pickTip({ percent, lastMilestone, recentlyShown });
    setMessage(result.message);
    if (result.milestone) setLastMilestone(result.milestone);
    setRecentlyShown((prev) => [result.message, ...prev].slice(0, RECENT_DEPTH));
    setOpen(true);
    setTipShownThisIdle(true);
  }, [isIdle, tipShownThisIdle, open, percent, lastMilestone, recentlyShown]);

  return <CashierTipModal open={open} message={message} onClose={() => setOpen(false)} />;
}
