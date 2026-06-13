// =============================================================================
// Stage C rules lock — client-side verification (real Firestore, CLIENT SDK)
// -----------------------------------------------------------------------------
// Run:  node --import tsx scripts/smoke/rulesLock.verify.ts
//
// Mints a token for a temp staff user (with access to a synthetic store) and
// attempts CLIENT writes: normal collections must still be writable; the four
// analytics rollup collections must be PERMISSION_DENIED. Self-cleaning.
// =============================================================================

import { readFileSync } from "fs";
import admin from "firebase-admin";
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

const STORE = "zzz-ruletest-store";
const UID = "zzz-ruletest-uid";

let failures = 0;
const ok = (m: string) => console.log("  ✅ " + m);
const bad = (m: string) => { failures++; console.log("  ❌ " + m); };
const codeOf = (e: any) => String(e?.code || e?.message || e);

async function expectAllow(label: string, fn: () => Promise<unknown>) {
  try { await fn(); ok(`${label}: allowed (expected)`); }
  catch (e) { bad(`${label}: DENIED but should be ALLOWED (${codeOf(e)})`); }
}
async function expectDeny(label: string, fn: () => Promise<unknown>) {
  try { await fn(); bad(`${label}: ALLOWED but should be DENIED`); }
  catch (e) {
    if (codeOf(e).includes("permission-denied")) ok(`${label}: denied (expected)`);
    else bad(`${label}: unexpected error ${codeOf(e)}`);
  }
}

async function main() {
  await adb.doc(`staff/${UID}`).set({ role: "manager", status: "active", assignedStoreIds: [STORE], name: "Rule Tester" });
  const token = await admin.auth().createCustomToken(UID);

  const app = initClient(firebaseConfig, "ruleverify");
  await signInWithCustomToken(getAuth(app), token);
  const cdb = getFirestore(app);

  console.log(`\n[rules lock verify] client signed in as staff ${UID} with access to ${STORE}\n`);

  await expectAllow("store doc", () => setDoc(doc(cdb, `stores/${STORE}`), { name: "rt", t: Date.now() }, { merge: true }));
  await expectAllow("receipts (normal coll)", () => setDoc(doc(cdb, `stores/${STORE}/receipts/zzz-ruleprobe`), { t: Date.now() }));
  await expectDeny("analytics", () => setDoc(doc(cdb, `stores/${STORE}/analytics/zzz-ruleprobe`), { t: Date.now() }));
  await expectDeny("analyticsMonths", () => setDoc(doc(cdb, `stores/${STORE}/analyticsMonths/zzz-ruleprobe`), { t: Date.now() }));
  await expectDeny("analyticsYears", () => setDoc(doc(cdb, `stores/${STORE}/analyticsYears/zzz-ruleprobe`), { t: Date.now() }));
  await expectDeny("dashPresets", () => setDoc(doc(cdb, `stores/${STORE}/dashPresets/zzz-ruleprobe`), { t: Date.now() }));
}

async function cleanup() {
  await adb.doc(`staff/${UID}`).delete().catch(() => {});
  await adb.doc(`stores/${STORE}/receipts/zzz-ruleprobe`).delete().catch(() => {});
  await adb.doc(`stores/${STORE}`).delete().catch(() => {});
}

main()
  .catch((e) => { failures++; console.error("VERIFY ERROR:", e); })
  .finally(async () => {
    await cleanup();
    console.log(failures === 0 ? "\nVERIFY: ✅ lock works — normal writes allowed, analytics denied\n" : `\nVERIFY: ❌ ${failures} issue(s)\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
