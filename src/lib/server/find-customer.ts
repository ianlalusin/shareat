import "server-only";

import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { classifyCustomerQuery, nameMatches } from "@/lib/loyalty/session-link";

export type CustomerHit = { phone: string; name: string; pointsBalance: number };
export type FindCustomersResult = {
  kind: "phone" | "name" | "incomplete";
  results: CustomerHit[];
};

/** Most-recent visitors first; bounds the scan so a big store can't blow up a request. */
export const NAME_SCAN_LIMIT = 500;
export const MAX_RESULTS = 10;

function toHit(id: string, data: any): CustomerHit {
  return {
    phone: id,
    name: String(data?.name ?? ""),
    pointsBalance: Number(data?.pointsBalance) || 0,
  };
}

/**
 * Customer lookup for the cashier "link card" flow.
 *  - phone query → exact doc get, any branch (typing a full number proves possession).
 *  - name query  → only customers who have visited THIS store (customers are
 *    store-scoped by design; see api/loyalty/store-customers), recent first.
 */
export async function findCustomers(
  db: Firestore,
  args: { storeId: string; q: string },
): Promise<FindCustomersResult> {
  const query = classifyCustomerQuery(args.q);

  if (query.kind === "incomplete") return { kind: "incomplete", results: [] };

  if (query.kind === "phone") {
    const snap = await db.doc(`customers/${query.phone}`).get();
    return { kind: "phone", results: snap.exists ? [toHit(snap.id, snap.data())] : [] };
  }

  const lastVisit = new FieldPath("storeVisits", args.storeId, "lastVisitAtMs");
  const snap = await db
    .collection("customers")
    .where(lastVisit, ">", 0)
    .orderBy(lastVisit, "desc")
    .limit(NAME_SCAN_LIMIT)
    .get();

  const results = snap.docs
    .map((d) => toHit(d.id, d.data()))
    .filter((c) => nameMatches(c.name, query.q))
    .slice(0, MAX_RESULTS);

  return { kind: "name", results };
}
