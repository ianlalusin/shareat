/**
 * B23 repair: receipts the OLD reconcile cron applied/reversed with incomplete
 * effects.
 *
 * Before the shared applier (src/lib/server/analytics/receiptEventApplier.ts),
 * the reconcile cron:
 *  - on a void reversal: reversed the sale but did NOT add the receipt's
 *    voidCashRetained to payments.voidCashRetainedTotal, did NOT drop its
 *    Daily Session Timeline row and did NOT decrement popularity;
 *  - on a pending payment: applied the sale but did NOT add popularity or the
 *    timeline row.
 * It then set analyticsReversed/analyticsApplied:true, so no later endpoint
 * retry ever filled those in.
 *
 * Detection: the old cron stamped analyticsReconciledAt with the SAME
 * serverTimestamp as analyticsReversedAt / analyticsAppliedAt in one write, so
 * equal timestamps identify which event the cron did. Receipts touched by the
 * new applier carry analyticsEffectsComplete:true and are skipped; repaired
 * receipts get analyticsB23RepairedAt so a second run is a no-op.
 *
 * Retained cash is NOT re-added when the receipt's analytics day was rebuilt by
 * the v6 rebuild after the reconcile (that rebuild re-derives retained cash).
 *
 * Not auto-fixed (listed for manual review):
 *  - a receipt the old cron APPLIED after it was already voided (its sale was
 *    projected as zero, then a later reversal subtracted the full sale);
 *  - a receipt both applied and reversed by the old cron (the second stamp
 *    overwrote the first, so the apply can't be proven).
 *
 * Usage (from the project root; dry run unless --write):
 *   TSX_TSCONFIG_PATH=scripts/smoke/tsconfig.smoke.json node --import tsx scripts/repair-b23-reconciled-receipts.ts
 *   ... --store=<storeId>     only this store (default: every store)
 *   ... --write               actually apply the repairs
 *
 * Credentials: FIREBASE_ADMIN_SA_PATH from .env.local.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Receipt, Store } from "../src/lib/types";
import { mergePopularityDeltas, popularityDeltaFromReceipt } from "../src/lib/analytics/popular-items";
import {
  removeDailySessionRow,
  upsertDailySessionRow,
} from "../src/lib/server/analytics/applyDailySessionRowServer";
import {
  EFFECTS_COMPLETE_FIELD,
  asOriginalReceipt,
  isVoidedReceipt,
  retainedCashDay,
  writePopularityDelta,
} from "../src/lib/server/analytics/receiptEventApplier";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const WRITE = args.write === "true";
const ONLY_STORE = args.store && args.store !== "true" ? String(args.store) : null;
const REPAIRED_FIELD = "analyticsB23RepairedAt";
const PAGE = 300;

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* ignore */
  }
}

function initAdmin(): Firestore {
  if (!getApps().length) {
    const saPath = process.env.FIREBASE_ADMIN_SA_PATH;
    if (!saPath) throw new Error("FIREBASE_ADMIN_SA_PATH not set (expected in .env.local).");
    const sa = JSON.parse(readFileSync(saPath, "utf8"));
    initializeApp({
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: String(sa.private_key || "").replace(/\\n/g, "\n"),
      }),
    });
    console.log(`[admin] firebase project: ${sa.project_id}`);
  }
  return getFirestore();
}

const sameTs = (a: any, b: any) => a instanceof Timestamp && b instanceof Timestamp && a.isEqual(b);
const ms = (t: any) => (t instanceof Timestamp ? t.toMillis() : null);

type Plan = {
  id: string;
  cronApplied: boolean;
  cronReversed: boolean;
  popularity: Record<string, number>;
  retained: number;
  retainedDayId: string | null;
  upsertRow: boolean;
  removeRow: boolean;
  manual: string | null;
};

/** Pure classification of one receipt + the facts read alongside it. */
function planFor(r: any, dayDoc: any, rowPresent: boolean): Plan | null {
  if (r[EFFECTS_COMPLETE_FIELD] === true || r[REPAIRED_FIELD]) return null;
  const rec = r.analyticsReconciledAt;
  if (!(rec instanceof Timestamp)) return null;

  const voided = isVoidedReceipt(r);
  const cronApplied = r.analyticsApplied === true && sameTs(r.analyticsAppliedAt, rec);
  const cronReversed = voided && r.analyticsReversed === true && sameTs(r.analyticsReversedAt, rec);
  if (!cronApplied && !cronReversed) return null;

  const plan: Plan = {
    id: r.id, cronApplied, cronReversed, popularity: {}, retained: 0, retainedDayId: null,
    upsertRow: false, removeRow: false, manual: null,
  };

  if (cronApplied) {
    const voidedMs = ms(r.voidedAt);
    if (voided && (voidedMs === null || voidedMs <= ms(rec)!)) {
      plan.manual = "old cron applied it after it was voided (sale projected as zero)";
      return plan;
    }
    // Its sale was projected; popularity +1 (a later reversal already did -1
    // if it went through the endpoint, or gets -1 below if through the cron).
    plan.popularity = popularityDeltaFromReceipt(asOriginalReceipt(r as Receipt), 1);
    plan.upsertRow = !voided;
  }

  if (cronReversed) {
    const original = asOriginalReceipt(r as Receipt);
    plan.popularity = mergePopularityDeltas(plan.popularity, popularityDeltaFromReceipt(original, -1));
    plan.removeRow = rowPresent;
    const retained = Number(r.voidCashRetained || 0);
    const day = retainedCashDay(r as Receipt);
    const rebuiltAfter =
      dayDoc?.meta?.source === "backfill_v6_server" &&
      dayDoc?.meta?.backfilledAt instanceof Timestamp &&
      dayDoc.meta.backfilledAt.toMillis() > ms(rec)!;
    if (retained > 0 && day && !rebuiltAfter) {
      plan.retained = retained;
      plan.retainedDayId = day.dayId;
    }
  }
  if (cronApplied && cronReversed) {
    plan.manual = "applied AND reversed by the old cron; apply side unprovable";
  }
  return plan;
}

async function repairStore(db: Firestore, storeId: string) {
  const storeSnap = await db.doc(`stores/${storeId}`).get();
  const store = storeSnap.exists ? ({ id: storeId, ...(storeSnap.data() as any) } as Store) : null;
  const totals = { scanned: 0, planned: 0, repaired: 0, manual: 0, retained: 0 };

  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db
      .collection(`stores/${storeId}/receipts`)
      .where("analyticsReconciledAt", ">", Timestamp.fromMillis(0))
      .orderBy("analyticsReconciledAt")
      .limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1];

    for (const d of snap.docs) {
      totals.scanned++;
      const ref = d.ref;
      // Classify + repair in one transaction so a concurrent run or applier
      // can't double-apply the (non-idempotent) popularity/retained increments.
      const outcome = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) return null;
        const r = { id: s.id, ...(s.data() as any) };
        const day = retainedCashDay(r as Receipt);
        const dayDoc = day ? (await tx.get(db.doc(`stores/${storeId}/analytics/${day.dayId}`))).data() : null;
        const rowDay = day ? (await tx.get(db.doc(`stores/${storeId}/dailySessions/${day.dayId}`))).data() : null;
        const plan = planFor(r, dayDoc, !!rowDay?.rows?.[r.id]);
        if (!plan || plan.manual || !WRITE) return plan;

        writePopularityDelta(db, storeId, plan.popularity, tx);
        if (plan.upsertRow) upsertDailySessionRow(db, storeId, r as Receipt, store, tx);
        if (plan.removeRow) removeDailySessionRow(db, storeId, r as Receipt, tx);
        if (plan.retained && plan.retainedDayId) {
          tx.set(
            db.doc(`stores/${storeId}/analytics/${plan.retainedDayId}`),
            { payments: { voidCashRetainedTotal: FieldValue.increment(plan.retained) }, meta: { updatedAt: FieldValue.serverTimestamp() } },
            { merge: true },
          );
        }
        tx.update(ref, { [REPAIRED_FIELD]: FieldValue.serverTimestamp() });
        return plan;
      });
      if (!outcome) continue;
      if (outcome.manual) {
        totals.manual++;
        console.log(`  MANUAL ${storeId}/${outcome.id}: ${outcome.manual}`);
        continue;
      }
      totals.planned++;
      totals.retained += outcome.retained;
      if (WRITE) totals.repaired++;
      console.log(
        `  ${WRITE ? "FIXED" : "would fix"} ${storeId}/${outcome.id}:` +
          `${outcome.cronApplied ? " cron-applied" : ""}${outcome.cronReversed ? " cron-reversed" : ""}` +
          ` popularity=${JSON.stringify(outcome.popularity)}` +
          `${outcome.retained ? ` retained+${outcome.retained}@${outcome.retainedDayId}` : ""}` +
          `${outcome.upsertRow ? " +row" : ""}${outcome.removeRow ? " -row" : ""}`,
      );
    }
    if (snap.size < PAGE) break;
  }
  return totals;
}

async function main() {
  loadEnvLocal();
  const db = initAdmin();
  console.log(WRITE ? "[mode] WRITE — repairs will be applied" : "[mode] DRY RUN — nothing is written (pass --write to apply)");
  const storeIds = ONLY_STORE ? [ONLY_STORE] : (await db.collection("stores").select().get()).docs.map((d) => d.id);
  const all = { scanned: 0, planned: 0, repaired: 0, manual: 0, retained: 0 };
  for (const id of storeIds) {
    const t = await repairStore(db, id);
    for (const k of Object.keys(all) as Array<keyof typeof all>) all[k] += t[k];
    if (t.planned || t.manual) console.log(`[store ${id}] ${JSON.stringify(t)}`);
  }
  console.log(`[total] ${JSON.stringify(all)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
