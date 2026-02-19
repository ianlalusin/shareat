"use client";

import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc, updateDoc, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { format, addDays, subDays } from 'date-fns';
import { forecastWeeklySales, type ForecastInput } from '@/ai/flows/forecast-weekly-sales';
import type { DailyMetric, SalesForecast } from '@/lib/types';

const FORECAST_ANALYTICS_KEY = 'forecast-analytics-last-run';
const RUN_INTERVAL_HOURS = 22;

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
  const todayForecastRef = doc(db, 'stores', storeId, 'salesForecasts', todayStr);
  const todayForecastSnap = await getDoc(todayForecastRef);

  if (!todayForecastSnap.exists()) {
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
            if (dayDiff < 0) {
                dayDiff += 7;
            }
            if (dayDiff === 0) { // If it's the same day of the week, it must be next week
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
  const [isLoading, setIsLoading] = useState(true);

  // Effect for the "cron" job
  useEffect(() => {
    if (!storeId || !storeAddress) return;

    const lastRun = localStorage.getItem(FORECAST_ANALYTICS_KEY);
    const shouldRun = !lastRun || (Date.now() - Number(lastRun) > RUN_INTERVAL_HOURS * 60 * 60 * 1000);

    if (shouldRun) {
      runForecastAnalytics(storeId, storeAddress).then(() => {
        localStorage.setItem(FORECAST_ANALYTICS_KEY, Date.now().toString());
      }).catch(error => {
        console.error("Error running forecast analytics tasks:", error);
      });
    }
  }, [storeId, storeAddress]);

  // Effect for fetching and displaying accuracy
  useEffect(() => {
    if (!storeId) {
      setAccuracy(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');

    const q = query(
      collection(db, 'stores', storeId, 'salesForecasts'),
      where('accuracy', '>=', 0),
      where('date', '>=', sevenDaysAgo),
      orderBy('date', 'desc'),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
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

    return () => unsubscribe();
  }, [storeId]);

  return { accuracy, isLoading };
}
