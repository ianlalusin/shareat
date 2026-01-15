
"use client";

import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export type RollupReconcileRow = {
  id: string; // YYYYMM or YYYY
  level: "month" | "year";
  childCount: number;
  sumNet: number;
  rollupNet: number;
  sumTx: number;
  rollupTx: number;
  netDiff: number;
  txDiff: number;
  ok: boolean;
};

export async function reconcileMonthsFromDays(storeId: string, year: number): Promise<RollupReconcileRow[]> {
  const results: RollupReconcileRow[] = [];

  for (let m = 1; m <= 12; m++) {
    const monthId = `${year}${String(m).padStart(2, "0")}`; // YYYYMM
    const startMs = new Date(year, m - 1, 1).getTime();
    const endMs = new Date(year, m, 1).getTime();

    // Sum daily docs for that month
    const daysRef = collection(db, "stores", storeId, "analytics");
    const qDays = query(
      daysRef,
      where("meta.dayStartMs", ">=", startMs),
      where("meta.dayStartMs", "<", endMs)
    );
    const daySnap = await getDocs(qDays);

    let sumNet = 0;
    let sumTx = 0;
    daySnap.forEach((d) => {
      const x: any = d.data();
      sumNet += Number(x?.payments?.totalGross ?? 0);
      sumTx += Number(x?.payments?.txCount ?? 0);
    });

    // Read month rollup doc
    const monthRef = doc(db, "stores", storeId, "analyticsMonths", monthId);
    const monthSnap = await getDoc(monthRef);
    const month = monthSnap.exists() ? (monthSnap.data() as any) : null;

    const rollupNet = Number(month?.payments?.totalGross ?? 0);
    const rollupTx = Number(month?.payments?.txCount ?? 0);

    const netDiff = sumNet - rollupNet;
    const txDiff = sumTx - rollupTx;

    const ok = Math.abs(netDiff) <= 2 && txDiff === 0;

    results.push({
      id: monthId,
      level: "month",
      childCount: daySnap.size,
      sumNet,
      rollupNet,
      sumTx,
      rollupTx,
      netDiff,
      txDiff,
      ok,
    });
  }

  return results;
}

export async function reconcileYearFromMonths(storeId: string, year: number): Promise<RollupReconcileRow> {
  // Sum 12 month docs
  const monthsRef = collection(db, "stores", storeId, "analyticsMonths");
  const qMonths = query(
    monthsRef,
    where("meta.monthId", ">=", `${year}01`),
    where("meta.monthId", "<=", `${year}12`)
  );
  const monthSnap = await getDocs(qMonths);

  let sumNet = 0;
  let sumTx = 0;
  monthSnap.forEach((d) => {
    const x: any = d.data();
    sumNet += Number(x?.payments?.totalGross ?? 0);
    sumTx += Number(x?.payments?.txCount ?? 0);
  });

  // Read year rollup doc
  const yearRef = doc(db, "stores", storeId, "analyticsYears", String(year));
  const yearSnap = await getDoc(yearRef);
  const y = yearSnap.exists() ? (yearSnap.data() as any) : null;

  const rollupNet = Number(y?.payments?.totalGross ?? 0);
  const rollupTx = Number(y?.payments?.txCount ?? 0);

  const netDiff = sumNet - rollupNet;
  const txDiff = sumTx - rollupTx;

  return {
    id: String(year),
    level: "year",
    childCount: monthSnap.size,
    sumNet,
    rollupNet,
    sumTx,
    rollupTx,
    netDiff,
    txDiff,
    ok: Math.abs(netDiff) <= 2 && txDiff === 0,
  };
}
