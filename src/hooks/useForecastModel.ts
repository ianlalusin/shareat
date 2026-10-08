"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { ForecastModel } from "@/lib/forecast/model";

export function useForecastModel(storeId?: string): { model: ForecastModel | null; isLoading: boolean } {
  const [model, setModel] = useState<ForecastModel | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(storeId));

  useEffect(() => {
    if (!storeId) { setModel(null); setIsLoading(false); return; }
    setIsLoading(true);
    return onSnapshot(
      doc(db, "stores", storeId, "forecastModel", "current"),
      (snap) => { setModel(snap.exists() ? (snap.data() as ForecastModel) : null); setIsLoading(false); },
      (err) => { console.error("forecastModel listen failed:", err); setModel(null); setIsLoading(false); },
    );
  }, [storeId]);

  return { model, isLoading };
}
