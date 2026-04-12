
"use client";

import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { format, subDays } from 'date-fns';
import type { Store } from '@/lib/types';

export function useForecastAnalytics(storeId?: string, _store?: Store) {
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [todaysProjectedSales, setTodaysProjectedSales] = useState<number | null>(null);
  const [todaysConfidence, setTodaysConfidence] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!storeId) {
      setAccuracy(null);
      setTodaysProjectedSales(null);
      setTodaysConfidence(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // Listener for today's forecast
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todayForecastRef = doc(db, 'stores', storeId, 'salesForecasts', todayStr);
    const unsubToday = onSnapshot(todayForecastRef, (snap) => {
      if (snap.exists()) {
        setTodaysProjectedSales(snap.data().projectedSales ?? null);
        setTodaysConfidence(snap.data().confidence ?? null);
      } else {
        setTodaysProjectedSales(null);
        setTodaysConfidence(null);
      }
    });

    // Listener for 7-day accuracy
    const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    const accuracyQuery = query(
      collection(db, 'stores', storeId, 'salesForecasts'),
      where('accuracy', '>=', 0),
      where('date', '>=', sevenDaysAgo),
      orderBy('date', 'desc'),
    );

    const unsubAccuracy = onSnapshot(accuracyQuery, (snapshot) => {
      if (snapshot.empty) {
        setAccuracy(null);
      } else {
        const accuracies = snapshot.docs.map(doc => doc.data().accuracy as number);
        const avgAccuracy = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length;
        setAccuracy(avgAccuracy);
      }
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching forecast accuracy:", error);
      setAccuracy(null);
      setIsLoading(false);
    });

    return () => {
      unsubToday();
      unsubAccuracy();
    };
  }, [storeId]);

  return { accuracy, todaysProjectedSales, todaysConfidence, isLoading };
}
