"use client";

import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

/**
 * Start-of-shift-day in ms, anchored at 4 AM Asia/Manila (mirrors getShiftDayId
 * in the cashier page). Before 4 AM, rolls back to the previous calendar day.
 * Used as the default period start for the first cash handover of the day.
 */
export function getShiftDayStartMs(now: Date = new Date()): number {
  const manila = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  if (manila.getHours() < 4) manila.setDate(manila.getDate() - 1);
  manila.setHours(4, 0, 0, 0);
  // Convert the Manila-local 4 AM back to a real epoch ms. The offset between
  // the faux-local clone and the true now gives the correction.
  const offset = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" })).getTime();
  return manila.getTime() + offset;
}

/**
 * Resolve the set of payment-method NAMES that count as cash for this store.
 * Receipt analytics store `mop` keyed by method name (net of change given), so
 * matching cash sales means matching those names. Falls back to any name
 * containing "cash".
 */
export async function getCashMethodNames(storeId: string): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const snap = await getDocs(
      query(collection(db, "stores", storeId, "storeModesOfPayment"), where("type", "==", "cash")),
    );
    snap.forEach((d) => {
      const name = (d.data() as any)?.name;
      if (name) names.add(String(name));
    });
  } catch {
    // ignore — fallback below still catches "cash"-named keys
  }
  return names;
}

/**
 * Sum cash sales from final receipts in [fromMs, toMs]. Reads receipts by the
 * `createdAtClientMs` range (single-field, no composite index), filters out
 * voids/refunds client-side, and sums the cash-named entries of each receipt's
 * `analytics.mop` (already net of change).
 */
export async function computeCashSales(
  storeId: string,
  fromMs: number,
  toMs: number,
): Promise<number> {
  const cashNames = await getCashMethodNames(storeId);
  const isCashKey = (k: string) =>
    cashNames.has(k) || k.toLowerCase().includes("cash");

  const snap = await getDocs(
    query(
      collection(db, "stores", storeId, "receipts"),
      where("createdAtClientMs", ">=", fromMs),
      where("createdAtClientMs", "<=", toMs),
    ),
  );

  let totalCents = 0;
  snap.forEach((d) => {
    const r = d.data() as any;
    if (r?.status === "voided" || r?.isRefund === true) return;
    const mop = (r?.analytics?.mop ?? {}) as Record<string, number>;
    for (const [k, v] of Object.entries(mop)) {
      if (isCashKey(k)) totalCents += Math.round(Number(v || 0) * 100);
    }
  });
  return totalCents / 100;
}
