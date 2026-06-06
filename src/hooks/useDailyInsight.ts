'use client';

import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { getDayIdFromTimestamp } from '@/lib/analytics/daily';
import type { DailyInsight } from '@/lib/types';

/** YYYYMMDD (Asia/Manila) for yesterday — the day the insight analyzes. */
export function yesterdayInsightDayId(): string {
  return getDayIdFromTimestamp(Date.now() - 86400000);
}

/**
 * Reads the cached daily insight doc for a store (yesterday's analysis).
 * One doc, one listener — never triggers generation.
 */
export function useDailyInsight(storeId?: string | null) {
  const [insight, setInsight] = useState<DailyInsight | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!storeId) {
      setInsight(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const dayId = yesterdayInsightDayId();
    const ref = doc(db, 'stores', storeId, 'aiInsights', dayId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setInsight(snap.exists() ? (snap.data() as DailyInsight) : null);
        setError(null);
        setIsLoading(false);
      },
      (err) => {
        console.error('useDailyInsight listener failed:', err);
        setError(err);
        setIsLoading(false);
      },
    );
    return () => unsub();
  }, [storeId]);

  return { insight, isLoading, error };
}
