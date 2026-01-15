
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

  // For each rollup doc, read its refillItems subcollection TopN
  await Promise.all(
    rollupDocRefs.map(async (ref) => {
      const itemsRef = collection(ref, "refillItems");
      const q = query(itemsRef, orderBy("qty", "desc"), limit(topN));
      const snap = await getDocs(q);
      snap.forEach((d) => mergeRefillAgg(merged, d.data()));
    })
  );

  // Final TopN across the whole range
  return Array.from(merged.values())
    .sort((a, b) => (b.qty ?? 0) - (a.qty ?? 0))
    .slice(0, topN);
}
