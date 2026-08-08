// =============================================================================
// Reconcile analytics — end-to-end smoke (real Firestore, admin SDK)
// -----------------------------------------------------------------------------
// Run:
//   TSX_TSCONFIG_PATH=scripts/smoke/tsconfig.smoke.json node --import tsx scripts/smoke/reconcileAnalytics.smoke.ts
//
// Simulates dropped endpoint calls: a pending-apply receipt (analyticsApplied:
// false) and a pending-reversal voided receipt (analyticsReversed:false), then
// runs the reconcile sweep and asserts both get applied and that a second run is
// an idempotent no-op. Synthetic store; self-cleaning.
// =============================================================================

import { readFileSync } from "fs";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { applyAnalyticsDeltaServer } from "../../src/lib/server/analytics/applyAnalyticsDeltaServer";
import { reconcileAnalyticsForStore } from "../../src/lib/server/analytics/reconcileAnalytics";

const SA_PATH = process.env.SA_PATH || "C:/Users/ianla/webapps/PK/POS.json";
const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const RUN = "__smoke_rec_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
const NOW = new Date(2026, 5, 12, 13, 0, 0);

let failures = 0;
const ok = (m: string) => console.log("  ✅ " + m);
const bad = (m: string) => { failures++; console.log("  ❌ " + m); };
const near = (a: any, b: number) => Math.abs(Number(a || 0) - b) < 0.001;

function rec(id: string, total: number, extra: Record<string, any>) {
  return {
    id, receiptId: id, storeId: RUN, status: "final", sessionMode: "package_dinein",
    total, createdAt: Timestamp.fromDate(NOW), createdAtClientMs: NOW.getTime(),
    analytics: { v: 2, grandTotal: total, mop: { cash: total }, discountsTotal: 0, chargesTotal: 0 },
    lines: [], ...extra,
  };
}
async function dayCash() {
  const snap = await db.collection(`stores/${RUN}/analytics`).get();
  return Number((snap.docs[0]?.data() as any)?.payments?.byMethod?.cash ?? 0);
}

async function main() {
  console.log(`\n[reconcile smoke] store=${RUN}\n`);

  // B was applied at payment then voided, but the void reversal call was dropped:
  // pre-apply its +300, then write it voided + analyticsReversed:false.
  const Bfinal = rec("B", 300, {});
  const b = db.batch();
  applyAnalyticsDeltaServer(db, RUN, null, Bfinal as any, b, NOW);
  await b.commit();
  await db.doc(`stores/${RUN}/receipts/B`).set(rec("B", 300, { status: "voided", analyticsApplied: true, analyticsReversed: false }));

  // A's payment apply was dropped: analyticsApplied:false.
  await db.doc(`stores/${RUN}/receipts/A`).set(rec("A", 500, { analyticsApplied: false }));

  const before = await dayCash();
  if (near(before, 300)) ok("baseline day cash == 300 (B pre-applied)"); else bad(`baseline = ${before}`);

  // Reconcile
  const r1 = await reconcileAnalyticsForStore(db, RUN);
  console.log(`Reconcile #1: applied=${r1.applied} reversed=${r1.reversed}`);
  if (r1.applied === 1) ok("applied 1 pending receipt (A)"); else bad(`applied = ${r1.applied}`);
  if (r1.reversed === 1) ok("reversed 1 pending void (B)"); else bad(`reversed = ${r1.reversed}`);

  const after = await dayCash();
  if (near(after, 500)) ok(`day cash == 500 (300 + A 500 - B 300)`); else bad(`day cash = ${after}`);

  const aDoc = (await db.doc(`stores/${RUN}/receipts/A`).get()).data() as any;
  const bDoc = (await db.doc(`stores/${RUN}/receipts/B`).get()).data() as any;
  if (aDoc?.analyticsApplied === true) ok("A.analyticsApplied == true"); else bad(`A.analyticsApplied = ${aDoc?.analyticsApplied}`);
  if (bDoc?.analyticsReversed === true) ok("B.analyticsReversed == true"); else bad(`B.analyticsReversed = ${bDoc?.analyticsReversed}`);

  // Idempotent re-run
  const r2 = await reconcileAnalyticsForStore(db, RUN);
  console.log(`Reconcile #2: applied=${r2.applied} reversed=${r2.reversed}`);
  if (r2.applied === 0 && r2.reversed === 0) ok("second run is a no-op (idempotent)"); else bad(`re-run applied=${r2.applied} reversed=${r2.reversed}`);
  if (near(await dayCash(), 500)) ok("day cash still 500"); else bad(`day cash drifted to ${await dayCash()}`);
}

async function cleanup() {
  for (const sub of ["receipts", "analytics", "analyticsMonths", "analyticsYears"]) {
    const snap = await db.collection(`stores/${RUN}/${sub}`).get();
    for (const d of snap.docs) await d.ref.delete();
  }
  console.log(`\n[cleanup] removed synthetic store ${RUN}`);
}

main()
  .catch((e) => { failures++; console.error("SMOKE ERROR:", e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup error:", e));
    console.log(failures === 0 ? "\nSMOKE RESULT: ✅ ALL PASS\n" : `\nSMOKE RESULT: ❌ ${failures} FAIL\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
