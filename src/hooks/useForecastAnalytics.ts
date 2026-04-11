
"use client";

import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, getDocs, doc, getDoc, updateDoc, setDoc, serverTimestamp, writeBatch, onSnapshot } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase/client';
import { format, addDays, subDays } from 'date-fns';
import type { ForecastInput } from '@/ai/flows/forecast-weekly-sales';
import type { DailyMetric, SalesForecast, Store, WeatherRecord } from '@/lib/types';
import { getUpcomingPayrollDates, getUpcomingHolidays, computeDayOfWeekAverages, computeTrendDirection } from '@/lib/utils/forecast-helpers';

const FORECAST_ANALYTICS_LAST_RUN_DATE_KEY = 'forecast-analytics-last-run-date';

async function runForecastAnalytics(storeId: string, store: Store) {
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const yesterdayStr = format(subDays(now, 1), 'yyyy-MM-dd');
  const yesterdayDayId = yesterdayStr.replace(/-/g, '');

  // --- 1. Update Yesterday's Accuracy ---
  const yesterdayForecastRef = doc(db, 'stores', storeId, 'salesForecasts', yesterdayStr);
  const yesterdayForecastSnap = await getDoc(yesterdayForecastRef);

  if (yesterdayForecastSnap.exists() && !yesterdayForecastSnap.data().accuracy) {
    const projectedSales = yesterdayForecastSnap.data().projectedSales;
    const analyticsRef = doc(db, 'stores', storeId, 'analytics', yesterdayDayId);
    const analyticsSnap = await getDoc(analyticsRef);

    if (analyticsSnap.exists()) {
      const actualSales = analyticsSnap.data().payments?.totalGross ?? 0;
      if (actualSales > 0) {
        const accuracy = 1 - Math.abs(actualSales - projectedSales) / actualSales;
        await updateDoc(yesterdayForecastRef, {
          actualSales,
          accuracy: Math.max(0, accuracy),
        });
      }
    }
  }

  // --- 2. Generate Forecasts for the upcoming week if needed ---
  const forecastForTomorrowRef = doc(db, 'stores', storeId, 'salesForecasts', format(addDays(now, 1), 'yyyy-MM-dd'));
  const forecastForTomorrowSnap = await getDoc(forecastForTomorrowRef);

  if (!forecastForTomorrowSnap.exists()) {
    const historyEndDate = subDays(now, 1);
    const historyStartDate = subDays(historyEndDate, 27);

    // Fetch historical sales
    const salesQuery = query(
      collection(db, "stores", storeId, "analytics"),
      where("meta.dayStartMs", ">=", historyStartDate.getTime()),
      where("meta.dayStartMs", "<=", historyEndDate.getTime()),
      orderBy("meta.dayStartMs", "desc")
    );

    // Fetch weather records
    const weatherQuery = query(
      collection(db, "stores", storeId, "weatherRecords"),
      where("dayId", ">=", format(historyStartDate, "yyyyMMdd")),
      where("dayId", "<=", format(historyEndDate, "yyyyMMdd"))
    );

    const [salesSnapshot, weatherSnapshot] = await Promise.all([
      getDocs(salesQuery),
      getDocs(weatherQuery),
    ]);

    const historicalSales = salesSnapshot.docs.map(d => {
      const data = d.data() as DailyMetric;
      return {
        date: format(new Date(data.meta.dayStartMs!), "yyyy-MM-dd"),
        netSales: data.payments?.totalGross ?? 0,
      };
    });

    if (historicalSales.length > 7) {
      // Build weather summary
      const historicalWeather = weatherSnapshot.docs.map(d => {
        const data = d.data() as WeatherRecord;
        const conditions = data.entries.map(e => e.condition);
        const conditionCounts = conditions.reduce((acc, cond) => {
          acc[cond] = (acc[cond] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const summary = Object.keys(conditionCounts).sort((a, b) => conditionCounts[b] - conditionCounts[a])[0] || 'clear';
        return {
          date: format(new Date(data.dayId.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')), "yyyy-MM-dd"),
          condition: summary.replace('_', ' '),
        };
      });

      // Compute analytics
      const config = store.forecastConfig;
      const upcomingPayrollDates = getUpcomingPayrollDates(config);
      const upcomingHolidays = getUpcomingHolidays(config).map(h => `${h.name} on ${h.date}`);
      const dayOfWeekAverages = computeDayOfWeekAverages(historicalSales);
      const { direction: trendDirection, ratio: recentVsHistoricalRatio } = computeTrendDirection(historicalSales);

      const forecastInput: ForecastInput = {
        historicalSales,
        historicalWeather,
        storeLocation: store.address,
        upcomingPayrollDates,
        upcomingHolidays,
        dayOfWeekAverages,
        trendDirection,
        recentVsHistoricalRatio,
        storeContext: config?.storeContext,
      };

      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch('/api/forecast-weekly-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(forecastInput),
      });

      if (res.ok) {
        const forecastResult = await res.json();
        const batch = writeBatch(db);

        forecastResult.forecast.forEach((dailyForecast: { day: string; forecastedSales: number; confidence?: string }) => {
          const todayDayIndex = now.getDay();
          const forecastDayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(dailyForecast.day);

          let dayDiff = forecastDayIndex - todayDayIndex;
          if (dayDiff <= 0) dayDiff += 7;

          const forecastDate = addDays(now, dayDiff);
          const forecastDateStr = format(forecastDate, 'yyyy-MM-dd');

          const forecastDocRef = doc(db, 'stores', storeId, 'salesForecasts', forecastDateStr);
          batch.set(forecastDocRef, {
            date: forecastDateStr,
            projectedSales: dailyForecast.forecastedSales,
            confidence: dailyForecast.confidence ?? null,
            createdAt: serverTimestamp(),
          }, { merge: true });
        });
        await batch.commit();
      }
    }
  }
}

export function useForecastAnalytics(storeId?: string, store?: Store) {
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [todaysProjectedSales, setTodaysProjectedSales] = useState<number | null>(null);
  const [todaysConfidence, setTodaysConfidence] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Effect for the daily "cron" job
  useEffect(() => {
    if (!storeId || !store) return;

    const todayDateStr = format(new Date(), 'yyyy-MM-dd');
    const lastRunDate = localStorage.getItem(FORECAST_ANALYTICS_LAST_RUN_DATE_KEY);

    const shouldRun = lastRunDate !== todayDateStr;

    if (shouldRun) {
      runForecastAnalytics(storeId, store).then(() => {
        localStorage.setItem(FORECAST_ANALYTICS_LAST_RUN_DATE_KEY, todayDateStr);
      }).catch(error => {
        console.error("Error running forecast analytics tasks:", error);
      });
    }
  }, [storeId, store]);

  // Combined effect for fetching accuracy and today's forecast
  useEffect(() => {
    if (!storeId) {
      setAccuracy(null);
      setTodaysProjectedSales(null);
      setTodaysConfidence(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // --- Listener for today's forecast ---
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

    // --- Listener for 7-day accuracy ---
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
