// =============================================================================
// TEST store — production end-to-end verification
// -----------------------------------------------------------------------------
// Run:  node --import tsx scripts/smoke/testStoreE2E.verify.ts
//
// Against the REAL "TEST" store + the DEPLOYED endpoint (app.shareat.net):
//   1. rules lock: a staff client may write receipts but NOT analytics
//   2. endpoint E2E: seed a receipt -> POST /api/analytics/apply-delta op:payment
//      (real auth) -> assert the TEST day analytics moved -> op:void -> assert it
//      nets back. Cleans up the receipt + temp staff after.
// =============================================================================

import { readFileSync } from "fs";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { initializeApp as initClient } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const SA_PATH = process.env.SA_PATH || "C:/Users/ianla/webapps/PK/POS.json";
const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const adb = admin.firestore();

const firebaseConfig = {
  apiKey: "AIzaSyBU1LQcbMS6aAQZrE2eXfrAd3mxv-56q4Y",
  authDomain: "shareat-hub-v2.firebaseapp.com",
  projectId: "shareat-hub-v2",
  storageBucket: "shareat-hub-v2.firebasestorage.app",
  messagingSenderId: "330037713504",
  appId: "1:330037713504:web:88960a43640431b92c0105",
};

const STORE = "TEST";
const UID = "zzz-teststore-uid";
const ENDPOINT = "https://app.shareat.net/api/analytics/apply-delta";
const NOW = new Date();
const RID = "zzz-e2e-" + Date.now().toString(36);

let failures = 0;
const ok = (m: string) => console.log("  ✅ " + m);
const bad = (m: string) => { failures++; console.log("  ❌ " + m); };
const codeOf = (e: any) => String(e?.code || e?.message || e);
const dayIdManila = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");

async function readDay(dayId: string) {
  const s = await adb.doc(`stores/${STORE}/analytics/${dayId}`).get();
  const x: any = s.exists ? s.data() : {};
  return { cash: Number(x?.payments?.byMethod?.cash ?? 0), tx: Number(x?.payments?.txCount ?? 0), gross: Number(x?.payments?.totalGross ?? 0) };
}
async function callEndpoint(idToken: string, op: string) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ storeId: STORE, receiptId: RID, op }),
  });
  const j = await res.json().catch(() => null);
  return { status: res.status, j };
}

async function main() {
  // temp staff + token
  await adb.doc(`staff/${UID}`).set({ role: "cashier", status: "active", assignedStoreIds: [STORE], name: "TEST E2E" });
  const token = await admin.auth().createCustomToken(UID);
  const app = initClient(firebaseConfig, "teststoree2e");
  const cred = await signInWithCustomToken(getAuth(app), token);
  const idToken = await cred.user.getIdToken();
  const cdb = getFirestore(app);
  console.log(`\n[TEST store E2E] store=${STORE} day=${dayIdManila(NOW)}\n`);

  // 1) Rules lock on the REAL TEST store
  console.log("Rules lock (client SDK):");
  try { await setDoc(doc(cdb, `stores/${STORE}/receipts/zzz-ruleprobe`), { t: Date.now() }); ok("client write receipts: allowed"); }
  catch (e) { bad(`client write receipts DENIED (${codeOf(e)})`); }
  try { await setDoc(doc(cdb, `stores/${STORE}/analytics/zzz-ruleprobe`), { t: Date.now() }); bad("client write analytics ALLOWED (should be denied)"); }
  catch (e) { if (codeOf(e).includes("permission-denied")) ok("client write analytics: denied"); else bad(`analytics write unexpected error ${codeOf(e)}`); }

  // 2) Endpoint E2E through the deployed app
  console.log("\nEndpoint E2E (deployed app.shareat.net):");
  const dayId = dayIdManila(NOW);
  await adb.doc(`stores/${STORE}/receipts/${RID}`).set({
    id: RID, receiptId: RID, storeId: STORE, status: "final", sessionMode: "package_dinein",
    total: 500, createdAt: Timestamp.fromDate(NOW), createdAtClientMs: NOW.getTime(),
    analytics: { v: 2, grandTotal: 500, mop: { cash: 500 }, discountsTotal: 0, chargesTotal: 0 },
    lines: [], analyticsApplied: false,
  });

  const before = await readDay(dayId);
  const pay = await callEndpoint(idToken, "payment");
  if (pay.status === 200 && pay.j?.ok) ok(`apply-delta payment -> 200 ok (applied=${pay.j?.applied})`); else bad(`payment -> ${pay.status} ${JSON.stringify(pay.j)}`);
  const afterPay = await readDay(dayId);
  if (afterPay.cash - before.cash === 500) ok(`day byMethod.cash +500 (${before.cash} -> ${afterPay.cash})`); else bad(`cash delta = ${afterPay.cash - before.cash}`);
  if (afterPay.tx - before.tx === 1) ok(`day txCount +1 (${before.tx} -> ${afterPay.tx})`); else bad(`tx delta = ${afterPay.tx - before.tx}`);

  const voidRes = await callEndpoint(idToken, "void");
  if (voidRes.status === 200 && voidRes.j?.ok) ok("apply-delta void -> 200 ok"); else bad(`void -> ${voidRes.status} ${JSON.stringify(voidRes.j)}`);
  const afterVoid = await readDay(dayId);
  if (afterVoid.cash === before.cash) ok(`day byMethod.cash back to ${before.cash}`); else bad(`cash after void = ${afterVoid.cash} (expected ${before.cash})`);
  if (afterVoid.tx === before.tx) ok(`day txCount back to ${before.tx}`); else bad(`tx after void = ${afterVoid.tx} (expected ${before.tx})`);
}

async function cleanup() {
  await adb.doc(`staff/${UID}`).delete().catch(() => {});
  await adb.doc(`stores/${STORE}/receipts/${RID}`).delete().catch(() => {});
  await adb.doc(`stores/${STORE}/receipts/zzz-ruleprobe`).delete().catch(() => {});
  console.log("\n[cleanup] removed temp staff + test receipts");
}

main()
  .catch((e) => { failures++; console.error("E2E ERROR:", e); })
  .finally(async () => {
    await cleanup();
    console.log(failures === 0 ? "\nTEST STORE E2E: ✅ ALL PASS\n" : `\nTEST STORE E2E: ❌ ${failures} issue(s)\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
