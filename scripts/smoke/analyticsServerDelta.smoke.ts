// =============================================================================
// Analytics server delta — end-to-end smoke (real Firestore, admin SDK)
// -----------------------------------------------------------------------------
// Run:
//   node --conditions=react-server --import tsx scripts/smoke/analyticsServerDelta.smoke.ts
//
// What it verifies (drives the REAL server writer applyAnalyticsDeltaServer):
//   - op:"payment"  → null -> receipt applies the expected increments to
//                     analytics / analyticsMonths / analyticsYears.
//   - op:"void"     → reconstructs the pre-void contribution (neutralized flag)
//                     and reverses it, so the day/month/year docs net to ZERO.
//
// Safety:
//   - Writes ONLY under a unique synthetic store id (`__smoke_<runid>`), so it
//     never touches the real TEST store dashboards. Deletes everything it wrote,
//     even on failure.
// =============================================================================

import { readFileSync } from "fs";
import admin from "firebase-admin";
import { applyAnalyticsDeltaServer } from "../../src/lib/server/analytics/applyAnalyticsDeltaServer";
import type { Receipt } from "../../src/lib/types";

const SA_PATH = process.env.SA_PATH || "C:/Users/ianla/webapps/PK/POS.json";
const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const RUN = "__smoke_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
const NOW = new Date(2026, 5, 12, 13, 0, 0); // fixed instant (no rolling-preset match)

let failures = 0;
const ok = (m: string) => console.log("  ✅ " + m);
const bad = (m: string) => { failures++; console.log("  ❌ " + m); };
const near = (a: number, b: number) => Math.abs(Number(a || 0) - b) < 0.001;

function finalReceipt(): Receipt {
  return {
    id: "r_" + RUN,
    receiptId: "r_" + RUN,
    storeId: RUN,
    status: "final",
    sessionMode: "package_dinein",
    total: 100,
    createdAtClientMs: NOW.getTime(),
    analytics: { v: 2, grandTotal: 100, mop: { gcash: 60, cash: 40 }, discountsTotal: 11.2, chargesTotal: 0 },
    lines: [],
  } as unknown as Receipt;
}
function asOriginal(r: Receipt): Receipt {
  return { ...(r as any), isVoided: false, status: (r as any).status === "voided" ? "final" : (r as any).status } as Receipt;
}

async function readAll(sub: string) {
  const snap = await db.collection(`stores/${RUN}/${sub}`).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

async function main() {
  console.log(`\n[analytics smoke] store=${RUN}\n`);
  const receipt = finalReceipt();

  // 1) Apply payment: null -> receipt
  const b1 = db.batch();
  applyAnalyticsDeltaServer(db, RUN, null, receipt, b1, NOW);
  await b1.commit();

  let days = await readAll("analytics");
  let months = await readAll("analyticsMonths");
  let years = await readAll("analyticsYears");

  console.log("After payment apply:");
  if (days.length === 1) ok(`1 daily doc created (${days[0].id})`); else bad(`expected 1 daily doc, got ${days.length}`);
  const day = days[0] || {};
  if (near(day?.payments?.totalGross, 100)) ok("payments.totalGross == 100"); else bad(`payments.totalGross = ${day?.payments?.totalGross}`);
  if (near(day?.payments?.txCount, 1)) ok("payments.txCount == 1"); else bad(`payments.txCount = ${day?.payments?.txCount}`);
  if (near(day?.payments?.byMethod?.gcash, 60)) ok("byMethod.gcash == 60"); else bad(`byMethod.gcash = ${day?.payments?.byMethod?.gcash}`);
  if (near(day?.payments?.discountsTotal, 11.2)) ok("payments.discountsTotal == 11.2"); else bad(`discountsTotal = ${day?.payments?.discountsTotal}`);
  if (months.length === 1 && near(months[0]?.payments?.totalGross, 100)) ok("month rollup == 100"); else bad(`month rollup = ${months[0]?.payments?.totalGross}`);
  if (years.length === 1 && near(years[0]?.payments?.totalGross, 100)) ok("year rollup == 100"); else bad(`year rollup = ${years[0]?.payments?.totalGross}`);

  // 2) Void reverse: read-back is a voided doc → reconstruct original, reverse to null
  const voided = { ...(receipt as any), status: "voided" } as Receipt;
  const b2 = db.batch();
  applyAnalyticsDeltaServer(db, RUN, asOriginal(voided), null, b2, NOW);
  await b2.commit();

  days = await readAll("analytics");
  months = await readAll("analyticsMonths");
  years = await readAll("analyticsYears");

  console.log("\nAfter void reversal (should net to zero):");
  const d2 = days[0] || {};
  if (near(d2?.payments?.totalGross, 0)) ok("payments.totalGross == 0"); else bad(`payments.totalGross = ${d2?.payments?.totalGross}`);
  if (near(d2?.payments?.txCount, 0)) ok("payments.txCount == 0"); else bad(`payments.txCount = ${d2?.payments?.txCount}`);
  if (near(d2?.payments?.byMethod?.gcash, 0)) ok("byMethod.gcash == 0"); else bad(`byMethod.gcash = ${d2?.payments?.byMethod?.gcash}`);
  if (near(d2?.payments?.discountsTotal, 0)) ok("payments.discountsTotal == 0"); else bad(`discountsTotal = ${d2?.payments?.discountsTotal}`);
  if (near(months[0]?.payments?.totalGross, 0)) ok("month rollup == 0"); else bad(`month rollup = ${months[0]?.payments?.totalGross}`);
  if (near(years[0]?.payments?.totalGross, 0)) ok("year rollup == 0"); else bad(`year rollup = ${years[0]?.payments?.totalGross}`);
}

async function cleanup() {
  for (const sub of ["analytics", "analyticsMonths", "analyticsYears", "dashPresets"]) {
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
