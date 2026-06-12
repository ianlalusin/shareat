// =============================================================================
// Payment conversion server — end-to-end smoke (real Firestore, admin SDK)
// -----------------------------------------------------------------------------
// Run:
//   TSX_TSCONFIG_PATH=scripts/smoke/tsconfig.smoke.json node --import tsx scripts/smoke/paymentConversionServer.smoke.ts
//
// Drives the REAL server module applyPaymentConversionServer:
//   - create → byMethod delta (from -amount, to +amount) on day/month/year
//   - void   → reverses it (nets to zero), conversion doc marked voided
//
// Safety: writes ONLY under a unique synthetic store id; deletes everything it
// wrote, even on failure.
// =============================================================================

import { readFileSync } from "fs";
import admin from "firebase-admin";
import {
  createPaymentConversionServer,
  voidPaymentConversionServer,
} from "../../src/lib/server/analytics/applyPaymentConversionServer";

const SA_PATH = process.env.SA_PATH || "C:/Users/ianla/webapps/PK/POS.json";
const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const RUN = "__smoke_conv_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
const NOW = new Date();
const actor = { uid: "smoke_uid", name: "Smoke Tester", role: "admin" as const };

let failures = 0;
const ok = (m: string) => console.log("  ✅ " + m);
const bad = (m: string) => { failures++; console.log("  ❌ " + m); };
const near = (a: any, b: number) => Math.abs(Number(a || 0) - b) < 0.001;

async function readAll(sub: string) {
  const snap = await db.collection(`stores/${RUN}/${sub}`).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

async function main() {
  console.log(`\n[payment-conversion smoke] store=${RUN}\n`);

  // create: cash -> gcash, 100
  const id = await createPaymentConversionServer(db, RUN, { amount: 100, fromMethod: "cash", toMethod: "gcash" }, actor, NOW);
  ok(`created conversion ${id}`);

  let days = await readAll("analytics");
  let months = await readAll("analyticsMonths");
  let years = await readAll("analyticsYears");
  const day = days[0] || {};
  console.log("After create:");
  if (days.length === 1) ok("1 daily doc"); else bad(`expected 1 daily doc, got ${days.length}`);
  if (near(day?.payments?.byMethod?.cash, -100)) ok("byMethod.cash == -100"); else bad(`byMethod.cash = ${day?.payments?.byMethod?.cash}`);
  if (near(day?.payments?.byMethod?.gcash, 100)) ok("byMethod.gcash == +100"); else bad(`byMethod.gcash = ${day?.payments?.byMethod?.gcash}`);
  if (day?.payments?.totalGross === undefined) ok("totalGross untouched (net-zero reshuffle)"); else bad(`totalGross unexpectedly set: ${day?.payments?.totalGross}`);
  if (near(months[0]?.payments?.byMethod?.gcash, 100)) ok("month rollup gcash == +100"); else bad(`month gcash = ${months[0]?.payments?.byMethod?.gcash}`);
  if (near(years[0]?.payments?.byMethod?.gcash, 100)) ok("year rollup gcash == +100"); else bad(`year gcash = ${years[0]?.payments?.byMethod?.gcash}`);

  // void
  const r = await voidPaymentConversionServer(db, RUN, id, actor, NOW);
  if (r.skipped === false) ok("void applied"); else bad("void unexpectedly skipped");

  days = await readAll("analytics");
  const d2 = days[0] || {};
  console.log("\nAfter void (should net to zero):");
  if (near(d2?.payments?.byMethod?.cash, 0)) ok("byMethod.cash == 0"); else bad(`byMethod.cash = ${d2?.payments?.byMethod?.cash}`);
  if (near(d2?.payments?.byMethod?.gcash, 0)) ok("byMethod.gcash == 0"); else bad(`byMethod.gcash = ${d2?.payments?.byMethod?.gcash}`);

  const conv = (await readAll("paymentConversions")).find((c) => c.id === id);
  if (conv?.status === "voided") ok("conversion doc marked voided"); else bad(`conversion status = ${conv?.status}`);

  // void again → idempotent skip
  const r2 = await voidPaymentConversionServer(db, RUN, id, actor, NOW);
  if (r2.skipped === true) ok("re-void is idempotent (skipped)"); else bad("re-void not skipped");
}

async function cleanup() {
  for (const sub of ["analytics", "analyticsMonths", "analyticsYears", "dashPresets", "paymentConversions"]) {
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
