import "server-only";

import type { Firestore } from "firebase-admin/firestore";

/** Max uids per request; callers resolve a page's worth of actors at once. */
export const STAFF_NAMES_MAX = 100;

/**
 * Display names for staff uids, limited to staff of `storeId` (assigned to it)
 * plus admins (who act in every store). Only the name leaves the server — no
 * email, phone, PIN fields, roles or store lists (audit B06). Former/inactive
 * staff are included so old events still show who did them. Unknown uids and
 * staff of other stores are simply absent from the result.
 */
export async function lookupStaffNames(db: Firestore, storeId: string, uids: string[]): Promise<Record<string, string>> {
  const wanted = Array.from(new Set(uids.filter((u) => typeof u === "string" && u && !u.includes("/")))).slice(0, STAFF_NAMES_MAX);
  if (!storeId || wanted.length === 0) return {};
  const snaps = await db.getAll(...wanted.map((uid) => db.doc(`staff/${uid}`)));
  const out: Record<string, string> = {};
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const d = snap.data() as any;
    const stores: string[] = Array.isArray(d?.assignedStoreIds) ? d.assignedStoreIds.map(String) : [];
    if (!stores.includes(storeId) && String(d?.role || "") !== "admin") continue;
    const name = [d?.name, d?.displayName, d?.username].find((v) => typeof v === "string" && v.trim());
    if (name) out[snap.id] = String(name).trim();
  }
  return out;
}
