
"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";

function dayIdFromDateManila(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(d)
    .reduce((acc: any, p) => (p.type !== "literal" ? ((acc[p.type] = p.value), acc) : acc), {});
  return `${parts.year}${parts.month}${parts.day}`;
}

function startOfDayManila(d: Date) {
  // create a Date representing Manila day start in UTC milliseconds
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

export type ReconcileRow = {
  dayId: string;
  receiptNet: number;
  rollupNet: number;
  receiptTx: number;
  rollupTx: number;
  netDiff: number;
  txDiff: number;
  mopDiff: Record<string, number>;
  ok: boolean;
};

export async function reconcileRange(storeId: string, start: Date, end: Date): Promise<ReconcileRow[]> {
  const rows: ReconcileRow[] = [];

  // iterate day by day (assumes end is inclusive-ish)
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const dayId = dayIdFromDateManila(cur);

    const dayStart = startOfDayManila(new Date(cur));
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // receipts of that day
    const receiptsRef = collection(db, "stores", storeId, "receipts");
    const rq = query(
      receiptsRef,
      where("createdAt", ">=", Timestamp.fromDate(dayStart)),
      where("createdAt", "<", Timestamp.fromDate(dayEnd))
    );

    const receiptSnap = await getDocs(rq);

    let receiptNet = 0;
    let receiptTx = 0;
    const mopSum: Record<string, number> = {};

    receiptSnap.forEach((d) => {
      const r: any = d.data();
      if (r.status === "voided") return;

      receiptTx += 1;
      receiptNet += Number(r.total ?? r.analytics?.grandTotal ?? 0);

      const mop = r.analytics?.mop ?? {};
      for (const [k, v] of Object.entries(mop)) {
        mopSum[k] = (mopSum[k] ?? 0) + Number(v || 0);
      }
    });

    // rollup doc
    const rollRef = doc(db, "stores", storeId, "analytics", dayId);
    const rollSnap = await getDoc(rollRef);
    const roll = rollSnap.exists() ? (rollSnap.data() as any) : null;

    const rollupNet = Number(roll?.payments?.totalGross ?? 0);
    const rollupTx = Number(roll?.payments?.txCount ?? 0);
    const rollMop: Record<string, number> = roll?.payments?.byMethod ?? {};

    const netDiff = receiptNet - rollupNet;
    const txDiff = receiptTx - rollupTx;

    const mopDiff: Record<string, number> = {};
    const keys = new Set([...Object.keys(mopSum), ...Object.keys(rollMop)]);
    keys.forEach((k) => (mopDiff[k] = (mopSum[k] ?? 0) - (rollMop[k] ?? 0)));

    const ok =
      Math.abs(netDiff) <= 2 &&
      txDiff === 0 &&
      Array.from(Object.values(mopDiff)).every((d) => Math.abs(d) <= 2);

    rows.push({
      dayId,
      receiptNet,
      rollupNet,
      receiptTx,
      rollupTx,
      netDiff,
      txDiff,
      mopDiff,
      ok,
    });
  }

  return rows;
}
