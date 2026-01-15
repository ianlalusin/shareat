
import { collection, getDocs, limit, orderBy, query, type DocumentReference } from "firebase/firestore";

type RefillAgg = { refillName: string; qty: number };

function mergeRefillAgg(target: Map<string, RefillAgg>, row: any) {
  const key = row.refillName;
  const cur = target.get(key) ?? { refillName: row.refillName, qty: 0 };
  cur.qty += row.qty ?? 0;
  target.set(key, cur);
}

export async function fetchTopRefillsForRollupDocs(
  db: any,
  rollupDocRefs: DocumentReference[],
  topN = 10
): Promise<RefillAgg[]> {
  const merged = new Map<string, RefillAgg>();

  // Use Promise.allSettled to handle potential errors in individual queries gracefully.
  const results = await Promise.allSettled(
    rollupDocRefs.map(async (ref) => {
      const itemsRef = collection(ref, "refillItems");
      const q = query(itemsRef, orderBy("qty", "desc"), limit(topN));
      return getDocs(q);
    })
  );

  // Process only the fulfilled promises.
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      const snap = result.value;
      snap.forEach((d) => mergeRefillAgg(merged, d.data()));
    } else {
      // Optionally log the error for debugging without stopping the process.
      console.warn("A subcollection query failed in fetchTopRefillsForRollupDocs:", result.reason);
    }
  });


  // Final TopN across the whole range
  return Array.from(merged.values())
    .sort((a, b) => (b.qty ?? 0) - (a.qty ?? 0))
    .slice(0, topN);
}
