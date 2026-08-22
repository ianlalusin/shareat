import type { Firestore } from "firebase-admin/firestore";

/**
 * Expired customer access PIN sweep.
 *
 * A PIN has a 2-hour TTL (src/app/api/pins/issue/route.ts:11) and is dead the
 * moment its session closes — it feeds no aggregate and carries no analytic
 * value, so unlike kitchen tickets this needs no retention horizon and no
 * rebuild guard. `CUSTOMER/src/app/api/admin/cleanup-archived-pins/route.ts`
 * was built to sweep the archived ones and was never run: as of 2026-08-22
 * there were 5,296 live pins, 5,277 of them already archived.
 *
 * Filtering on `expiresAtMs` rather than `status` catches both the archived
 * population and pins that expired without ever being archived, in one
 * single-field query that needs no composite index.
 *
 * Deliberately free of `server-only` and of `@/` path aliases: both the cron
 * route and `scripts/purge-expired-pins.ts` import this, and the script runs
 * under tsx outside Next's module resolution.
 */

const DAY_MS = 86_400_000;
const DELETE_BATCH = 500;

/** Days past expiry a PIN is kept, so /admin stays useful for support lookups. */
export const DEFAULT_GRACE_DAYS = 7;

export type PurgePinsResult = {
  /** Docs in pinRegistry before the sweep. */
  total: number;
  /** Docs matching the expiry filter. */
  candidates: number;
  /** Docs actually deleted — always 0 when write is false. */
  deleted: number;
  graceDays: number;
  cutoffMs: number;
};

export async function purgeExpiredPins(
  db: Firestore,
  opts: { nowMs: number; write: boolean; graceDays?: number },
): Promise<PurgePinsResult> {
  const graceDays = opts.graceDays ?? DEFAULT_GRACE_DAYS;
  const cutoffMs = opts.nowMs - graceDays * DAY_MS;

  const base = db
    .collection("pinRegistry")
    .where("expiresAtMs", "<", cutoffMs)
    .orderBy("expiresAtMs", "asc");

  const total = (await db.collection("pinRegistry").count().get()).data().count;
  const candidates = (await base.count().get()).data().count;

  // Never sweep the whole collection. If every pin looks expired the field is
  // wrong or the clock is, and deleting all of them would take live sessions'
  // PINs with it.
  if (candidates > 0 && candidates === total) {
    throw new Error(
      "Every pin matched the expiry filter — refusing to run. Check expiresAtMs and the grace window.",
    );
  }

  if (!opts.write) return { total, candidates, deleted: 0, graceDays, cutoffMs };

  let deleted = 0;
  for (;;) {
    const snap = await base.limit(DELETE_BATCH).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    deleted += snap.size;
    if (snap.size < DELETE_BATCH) break;
  }

  return { total, candidates, deleted, graceDays, cutoffMs };
}
