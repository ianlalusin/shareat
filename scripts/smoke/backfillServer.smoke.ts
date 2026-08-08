// =============================================================================
// Analytics backfill server — end-to-end smoke (real Firestore, admin SDK)
// -----------------------------------------------------------------------------
// Run:
//   TSX_TSCONFIG_PATH=scripts/smoke/tsconfig.smoke.json node --import tsx scripts/smoke/backfillServer.smoke.ts
//
// Drives the REAL server backfill: seeds a store + 2 receipts, rebuilds the daily
// doc, the dashboard presets, and the month/year rollups, asserting each.
//
// Safety: synthetic store id only; deletes everything it wrote.
// =============================================================================

import { readFileSync } from "fs";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  rebuildDailyAnalyticsFromReceiptsServer,
  rebuildDashboardPresetsServer,
  backfillSessionDurationRollupsServer,
} from "../../src/lib/server/analytics/backfillServer";

const SA_PATH = process.env.SA_PATH || "C:/Users/ianla/webapps/PK/POS.json";
const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const RUN = "__smoke_bf_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
const NOW = new Date();
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

let failures = 0;
const ok = (m: string) => console.log("  ✅ " + m);
const bad = (m: string) => { failures++; console.log("  ❌ " + m); };
const near = (a: any, b: number) => Math.abs(Number(a || 0) - b) < 0.001;

function receipt(id: string, total: number, mop: Record<string, number>) {
  return {
    id, receiptId: id, storeId: RUN, status: "final", sessionMode: "package_dinein",
    total, createdAt: Timestamp.fromDate(NOW), createdAtClientMs: NOW.getTime(),
    analytics: { v: 2, grandTotal: total, mop, discountsTotal: 0, chargesTotal: 0 },
    lines: [],
  };
}

async function main() {
  console.log(`\n[backfill smoke] store=${RUN}\n`);

  await db.doc(`stores/${RUN}`).set({ name: "SMOKE", createdAt: Timestamp.fromDate(NOW) });
  await db.doc(`stores/${RUN}/receipts/r1`).set(receipt("r1", 200, { cash: 200 }));
  await db.doc(`stores/${RUN}/receipts/r2`).set(receipt("r2", 100, { gcash: 100 }));

  // 1) Rebuild daily
  const day = startOfDay(NOW);
  const dRes = await rebuildDailyAnalyticsFromReceiptsServer(db, RUN, day, day);
  console.log(`Daily rebuild: ${dRes.days} day(s), ${dRes.receipts} receipt(s)`);
  if (dRes.receipts === 2) ok("read 2 receipts"); else bad(`receipts = ${dRes.receipts}`);
  if (dRes.days === 1) ok("wrote 1 daily doc"); else bad(`days = ${dRes.days}`);

  const days = (await db.collection(`stores/${RUN}/analytics`).get()).docs.map((d) => d.data() as any);
  const dd = days[0] || {};
  if (near(dd?.payments?.totalGross, 300)) ok("daily payments.totalGross == 300"); else bad(`= ${dd?.payments?.totalGross}`);
  if (near(dd?.payments?.txCount, 2)) ok("daily payments.txCount == 2"); else bad(`= ${dd?.payments?.txCount}`);
  if (near(dd?.payments?.byMethod?.cash, 200)) ok("daily byMethod.cash == 200"); else bad(`= ${dd?.payments?.byMethod?.cash}`);
  if (near(dd?.payments?.byMethod?.gcash, 100)) ok("daily byMethod.gcash == 100"); else bad(`= ${dd?.payments?.byMethod?.gcash}`);

  // 2) Rebuild presets (today's window includes the seeded day)
  const pRes = await rebuildDashboardPresetsServer(db, RUN, NOW);
  console.log(`\nPreset rebuild: ${pRes.presets} preset(s)`);
  const today = (await db.doc(`stores/${RUN}/dashPresets/today`).get()).data() as any;
  if (near(today?.payments?.totalGross, 300)) ok("preset 'today' payments.totalGross == 300"); else bad(`= ${today?.payments?.totalGross}`);

  // 3) Rollups (creates month/year docs; duration 0 here — assert docs written)
  const rRes = await backfillSessionDurationRollupsServer(db, RUN, day, day);
  console.log(`\nRollups: ${rRes.months} month(s), ${rRes.years} year(s)`);
  if (rRes.months === 1 && rRes.years === 1) ok("1 month + 1 year rollup written"); else bad(`months=${rRes.months} years=${rRes.years}`);
}

async function cleanup() {
  for (const sub of ["receipts", "analytics", "analyticsMonths", "analyticsYears", "dashPresets"]) {
    const snap = await db.collection(`stores/${RUN}/${sub}`).get();
    for (const d of snap.docs) await d.ref.delete();
  }
  await db.doc(`stores/${RUN}`).delete().catch(() => {});
  console.log(`\n[cleanup] removed synthetic store ${RUN}`);
}

main()
  .catch((e) => { failures++; console.error("SMOKE ERROR:", e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup error:", e));
    console.log(failures === 0 ? "\nSMOKE RESULT: ✅ ALL PASS\n" : `\nSMOKE RESULT: ❌ ${failures} FAIL\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
