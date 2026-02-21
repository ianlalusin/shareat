
"use client";

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc, updateDoc, setDoc, serverTimestamp, writeBatch, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { format, addDays, subDays } from 'date-fns';
import { forecastWeeklySales, type ForecastInput } from '@/ai/flows/forecast-weekly-sales';
import type { DailyMetric, SalesForecast } from '@/lib/types';

const FORECAST_ANALYTICS_LAST_RUN_DATE_KEY = 'forecast-analytics-last-run-date';

async function runForecastAnalytics(storeId: string, storeAddress: string) {
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
          accuracy: Math.max(0, accuracy), // Accuracy can't be negative
        });
      }
    }
  }

  // --- 2. Generate Forecasts for the upcoming week if needed ---
  // Check if forecast for *tomorrow* exists. If not, generate for the week.
  const forecastForTomorrowRef = doc(db, 'stores', storeId, 'salesForecasts', format(addDays(now, 1), 'yyyy-MM-dd'));
  const forecastForTomorrowSnap = await getDoc(forecastForTomorrowRef);

  if (!forecastForTomorrowSnap.exists()) {
    // Fetch last 28 days of sales data
    const historyEndDate = subDays(now, 1);
    const historyStartDate = subDays(historyEndDate, 27);

    const salesQuery = query(
      collection(db, "stores", storeId, "analytics"),
      where("meta.dayStartMs", ">=", historyStartDate.getTime()),
      where("meta.dayStartMs", "<=", historyEndDate.getTime()),
      orderBy("meta.dayStartMs", "desc")
    );
    const salesSnapshot = await getDocs(salesQuery);
    const historicalSales = salesSnapshot.docs.map(doc => {
      const data = doc.data() as DailyMetric;
      return {
        date: format(new Date(data.meta.dayStartMs!), "yyyy-MM-dd"),
        netSales: data.payments?.totalGross ?? 0,
      };
    });

    if (historicalSales.length > 7) {
      const forecastInput: ForecastInput = {
        historicalSales,
        storeLocation: storeAddress,
      };
      
      const res = await fetch('/api/forecast-weekly-sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(forecastInput),
      });

      if (res.ok) {
        const forecastResult = await res.json();
        const batch = writeBatch(db);

        forecastResult.forecast.forEach((dailyForecast: { day: string, forecastedSales: number }) => {
            const todayDayIndex = now.getDay(); // 0 for Sunday, 1 for Monday...
            const forecastDayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(dailyForecast.day);
            
            let dayDiff = forecastDayIndex - todayDayIndex;
            if (dayDiff <= 0) { // If it's today or a past day of the week, schedule for next week
                dayDiff += 7;
            }

            const forecastDate = addDays(now, dayDiff);
            const forecastDateStr = format(forecastDate, 'yyyy-MM-dd');
            
            const forecastDocRef = doc(db, 'stores', storeId, 'salesForecasts', forecastDateStr);
            batch.set(forecastDocRef, {
                date: forecastDateStr,
                projectedSales: dailyForecast.forecastedSales,
                createdAt: serverTimestamp(),
            }, { merge: true });
        });
        await batch.commit();
      }
    }
  }
}

export function useForecastAnalytics(storeId?: string, storeAddress?: string) {
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [todaysProjectedSales, setTodaysProjectedSales] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Effect for the daily "cron" job
  useEffect(() => {
    if (!storeId || !storeAddress) return;

    const todayDateStr = format(new Date(), 'yyyy-MM-dd');
    const lastRunDate = localStorage.getItem(FORECAST_ANALYTICS_LAST_RUN_DATE_KEY);
    
    const shouldRun = lastRunDate !== todayDateStr;

    if (shouldRun) {
      runForecastAnalytics(storeId, storeAddress).then(() => {
        localStorage.setItem(FORECAST_ANALYTICS_LAST_RUN_DATE_KEY, todayDateStr);
      }).catch(error => {
        console.error("Error running forecast analytics tasks:", error);
      });
    }
  }, [storeId, storeAddress]);

  // Combined effect for fetching accuracy and today's forecast
  useEffect(() => {
    if (!storeId) {
      setAccuracy(null);
      setTodaysProjectedSales(null);
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
      } else {
        setTodaysProjectedSales(null);
      }
      // Don't set loading false here, wait for accuracy
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
      // This is the last listener, so we can set loading state
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

  return { accuracy, todaysProjectedSales, isLoading };
}
