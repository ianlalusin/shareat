'use client';

import { useState, useEffect } from 'react';
import { doc, onSnapshot, collection, query, orderBy, limit } from 'firebase/firestore';
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

/**
 * Lists a store's recent daily-insight docs (newest first) for the history view.
 * Doc ids are YYYYMMDD so `dayId` desc is chronological.
 */
export function useInsightList(storeId?: string | null, max = 60) {
  const [items, setItems] = useState<DailyInsight[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!storeId) {
      setItems([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const q = query(collection(db, 'stores', storeId, 'aiInsights'), orderBy('dayId', 'desc'), limit(max));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => d.data() as DailyInsight));
        setIsLoading(false);
      },
      (err) => {
        console.error('useInsightList listener failed:', err);
        setItems([]);
        setIsLoading(false);
      },
    );
    return () => unsub();
  }, [storeId, max]);

  return { items, isLoading };
}
