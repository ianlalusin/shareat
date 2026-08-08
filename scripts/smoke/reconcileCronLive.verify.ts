// =============================================================================
// Reconcile cron — LIVE verification on the TEST store (deployed app)
// -----------------------------------------------------------------------------
// Run:  node --import tsx scripts/smoke/reconcileCronLive.verify.ts
//
// Seeds a pending receipt in the real TEST store, calls the DEPLOYED reconcile
// cron (with CRON_SECRET), and asserts it gets applied; then marks it voided +
// pending and asserts the cron reverses it. Cleans up the receipt.
// =============================================================================

import { readFileSync } from "fs";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

const SA_PATH = process.env.SA_PATH || "C:/Users/ianla/webapps/PK/POS.json";
const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const env = readFileSync(".env.local", "utf8");
const CRON_SECRET = (env.match(/^CRON_SECRET=(.*)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
const ENDPOINT = "https://app.shareat.net/api/cron/reconcile-analytics";
const STORE = "TEST";
const RID = "zzz-rec-" + Date.now().toString(36);
const NOW = new Date();
const dayId = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(NOW).replace(/-/g, "");

let failures = 0;
const ok = (m: string) => console.log("  ✅ " + m);
const bad = (m: string) => { failures++; console.log("  ❌ " + m); };
const near = (a: any, b: number) => Math.abs(Number(a || 0) - b) < 0.001;

async function readDay() {
  const s = await db.doc(`stores/${STORE}/analytics/${dayId}`).get();
  const x: any = s.exists ? s.data() : {};
  return { cash: Number(x?.payments?.byMethod?.cash ?? 0), tx: Number(x?.payments?.txCount ?? 0) };
}
async function callCron() {
  const res = await fetch(ENDPOINT, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  const j = await res.json().catch(() => null);
  return { status: res.status, j };
}

async function main() {
  if (!CRON_SECRET) { bad("CRON_SECRET not found in .env.local"); return; }
  console.log(`\n[reconcile cron LIVE] store=${STORE} day=${dayId} receipt=${RID}\n`);

  await db.doc(`stores/${STORE}/receipts/${RID}`).set({
    id: RID, receiptId: RID, storeId: STORE, status: "final", sessionMode: "package_dinein",
    total: 250, createdAt: Timestamp.fromDate(NOW), createdAtClientMs: NOW.getTime(),
    analytics: { v: 2, grandTotal: 250, mop: { cash: 250 }, discountsTotal: 0, chargesTotal: 0 },
    lines: [], analyticsApplied: false,
  });

  const before = await readDay();

  // 1) pending apply -> cron applies it
  const c1 = await callCron();
  if (c1.status === 200 && c1.j?.ok) ok(`cron -> 200 ok (applied=${c1.j?.applied}, reversed=${c1.j?.reversed})`); else bad(`cron -> ${c1.status} ${JSON.stringify(c1.j)}`);
  const a1 = (await db.doc(`stores/${STORE}/receipts/${RID}`).get()).data() as any;
  if (a1?.analyticsApplied === true) ok("receipt.analyticsApplied == true"); else bad(`analyticsApplied = ${a1?.analyticsApplied}`);
  const afterApply = await readDay();
  if (near(afterApply.cash - before.cash, 250)) ok(`day cash +250 (${before.cash} -> ${afterApply.cash})`); else bad(`cash delta = ${afterApply.cash - before.cash}`);
  if (afterApply.tx - before.tx === 1) ok(`day txCount +1`); else bad(`tx delta = ${afterApply.tx - before.tx}`);

  // 2) mark voided + pending -> cron reverses it
  await db.doc(`stores/${STORE}/receipts/${RID}`).update({ status: "voided", analyticsReversed: false });
  const c2 = await callCron();
  if (c2.status === 200 && c2.j?.ok) ok(`cron -> 200 ok (applied=${c2.j?.applied}, reversed=${c2.j?.reversed})`); else bad(`cron -> ${c2.status} ${JSON.stringify(c2.j)}`);
  const a2 = (await db.doc(`stores/${STORE}/receipts/${RID}`).get()).data() as any;
  if (a2?.analyticsReversed === true) ok("receipt.analyticsReversed == true"); else bad(`analyticsReversed = ${a2?.analyticsReversed}`);
  const afterVoid = await readDay();
  if (near(afterVoid.cash, before.cash)) ok(`day cash back to ${before.cash}`); else bad(`cash after void = ${afterVoid.cash} (expected ${before.cash})`);
  if (afterVoid.tx === before.tx) ok(`day txCount back to ${before.tx}`); else bad(`tx after void = ${afterVoid.tx}`);
}

async function cleanup() {
  await db.doc(`stores/${STORE}/receipts/${RID}`).delete().catch(() => {});
  console.log("\n[cleanup] removed test receipt");
}

main()
  .catch((e) => { failures++; console.error("LIVE VERIFY ERROR:", e); })
  .finally(async () => {
    await cleanup();
    console.log(failures === 0 ? "\nRECONCILE CRON LIVE: ✅ ALL PASS\n" : `\nRECONCILE CRON LIVE: ❌ ${failures} issue(s)\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
