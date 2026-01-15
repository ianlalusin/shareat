
"use client";

import { collection, getDocs, limit, orderBy, query, type DocumentReference } from "firebase/firestore";

export type AddonAgg = { itemName: string; categoryName: string; qty: number; amount: number };

function mergeAddonAgg(target: Map<string, AddonAgg>, row: any) {
  const key = row.itemName;
  const cur =
    target.get(key) ??
    { itemName: row.itemName, categoryName: row.categoryName ?? "Uncategorized", qty: 0, amount: 0 };

  cur.qty += Number(row.qty ?? 0);
  cur.amount += Number(row.amount ?? 0);
  if (!cur.categoryName && row.categoryName) cur.categoryName = row.categoryName;

  target.set(key, cur);
}

export async function fetchTopAddonsForRollupDocs(db: any, rollupDocRefs: DocumentReference[], topN = 10): Promise<AddonAgg[]> {
  const merged = new Map<string, AddonAgg>();

  const results = await Promise.allSettled(
    rollupDocRefs.map(async (ref) => {
      const itemsRef = collection(ref, "addonItems");
      const q = query(itemsRef, orderBy("amount", "desc"), limit(topN));
      const snap = await getDocs(q);
      snap.forEach((d) => mergeAddonAgg(merged, d.data()));
    })
  );

  // ignore rejected; keeps partial results
  void results;

  return Array.from(merged.values())
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, topN);
}
