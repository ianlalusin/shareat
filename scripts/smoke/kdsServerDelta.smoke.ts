// =============================================================================
// KDS analytics server delta — end-to-end smoke (real Firestore, admin SDK)
// -----------------------------------------------------------------------------
// Run:
//   TSX_TSCONFIG_PATH=scripts/smoke/tsconfig.smoke.json node --import tsx scripts/smoke/kdsServerDelta.smoke.ts
//
// Drives the REAL marker-based writer applyKdsTicketDeltaServer:
//   - partial serve (2/5) → +2 served, marker advances
//   - full serve (5/5 + duration) → +3 served, +duration (type/location/user)
//   - idempotent re-call → no change
//   - refill serve → refills.servedRefillsTotal/byName
//   - cancel → cancelledCountByType
//
// Safety: synthetic store id only; deletes everything it wrote.
// =============================================================================

import { readFileSync } from "fs";
import admin from "firebase-admin";
import { applyKdsTicketDeltaServer, type KdsMarkers, type KdsServerActor } from "../../src/lib/server/analytics/applyKdsTicketDeltaServer";

const SA_PATH = process.env.SA_PATH || "C:/Users/ianla/webapps/PK/POS.json";
const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const RUN = "__smoke_kds_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
const NOW = new Date(2026, 5, 12, 13, 0, 0);
const MS = NOW.getTime();

let failures = 0;
const ok = (m: string) => console.log("  ✅ " + m);
const bad = (m: string) => { failures++; console.log("  ❌ " + m); };
const near = (a: any, b: number) => Math.abs(Number(a || 0) - b) < 0.001;

async function applyTicket(ticket: any, actor?: KdsServerActor): Promise<{ markers: KdsMarkers; changed: boolean }> {
  const batch = db.batch();
  const res = applyKdsTicketDeltaServer(db, RUN, ticket, batch, NOW, actor);
  await batch.commit();
  return res;
}
async function dayDoc() {
  const snap = await db.collection(`stores/${RUN}/analytics`).get();
  return (snap.docs[0]?.data() as any) || {};
}

async function main() {
  console.log(`\n[KDS smoke] store=${RUN}\n`);

  // Ticket A: package, location L1, cook U1. Partial 2/5 → full 5/5 (+60s).
  const actor: KdsServerActor = { profileId: "U1", name: "Cook One" };
  let A: any = {
    type: "package", qty: 5, kitchenLocationId: "L1", createdAtClientMs: MS,
    status: "partially_served", qtyServed: 2, qtyCancelled: 0,
    analyticsServedQty: 0, analyticsCancelledQty: 0, analyticsDurationMs: 0, analyticsDurationCount: 0,
  };
  let r = await applyTicket(A, actor);
  A = { ...A, ...r.markers };
  console.log("After partial serve 2/5:");
  let d = await dayDoc();
  if (near(d?.kitchen?.servedCountByType?.package, 2)) ok("servedCountByType.package == 2"); else bad(`= ${d?.kitchen?.servedCountByType?.package}`);
  if (near(d?.kitchen?.durationCountByType?.package, 0)) ok("no duration yet (partial)"); else bad(`durationCount = ${d?.kitchen?.durationCountByType?.package}`);

  A = { ...A, status: "served", qtyServed: 5, durationMs: 60000, servedAtClientMs: MS };
  r = await applyTicket(A, actor);
  A = { ...A, ...r.markers };
  console.log("\nAfter full serve 5/5 (+60s):");
  d = await dayDoc();
  if (near(d?.kitchen?.servedCountByType?.package, 5)) ok("servedCountByType.package == 5"); else bad(`= ${d?.kitchen?.servedCountByType?.package}`);
  if (near(d?.kitchen?.durationMsSumByType?.package, 60000)) ok("durationMsSumByType.package == 60000"); else bad(`= ${d?.kitchen?.durationMsSumByType?.package}`);
  if (near(d?.kitchen?.durationCountByType?.package, 1)) ok("durationCountByType.package == 1"); else bad(`= ${d?.kitchen?.durationCountByType?.package}`);
  if (near(d?.kitchen?.durationMsSumByLocation?.L1, 60000)) ok("durationMsSumByLocation.L1 == 60000"); else bad(`= ${d?.kitchen?.durationMsSumByLocation?.L1}`);
  if (near(d?.kitchen?.servingMsSumByUser?.U1, 60000)) ok("servingMsSumByUser.U1 == 60000"); else bad(`= ${d?.kitchen?.servingMsSumByUser?.U1}`);
  if (d?.staffNames?.U1 === "Cook One") ok("staffNames.U1 == 'Cook One'"); else bad(`staffNames.U1 = ${d?.staffNames?.U1}`);

  console.log("\nIdempotent re-call (no field changes):");
  r = await applyTicket(A, actor);
  if (r.changed === false) ok("changed == false (no-op)"); else bad("re-call unexpectedly changed");
  d = await dayDoc();
  if (near(d?.kitchen?.servedCountByType?.package, 5)) ok("servedCountByType.package still 5"); else bad(`= ${d?.kitchen?.servedCountByType?.package}`);

  // Ticket B: refill 'Soup', served 1 (+30s), no location/actor.
  console.log("\nRefill serve:");
  const B: any = {
    type: "refill", refillName: "Soup", qty: 1, createdAtClientMs: MS,
    status: "served", qtyServed: 1, durationMs: 30000, servedAtClientMs: MS,
    analyticsServedQty: 0, analyticsCancelledQty: 0, analyticsDurationMs: 0, analyticsDurationCount: 0,
  };
  await applyTicket(B);
  d = await dayDoc();
  if (near(d?.kitchen?.servedCountByType?.refill, 1)) ok("servedCountByType.refill == 1"); else bad(`= ${d?.kitchen?.servedCountByType?.refill}`);
  if (near(d?.refills?.servedRefillsTotal, 1)) ok("refills.servedRefillsTotal == 1"); else bad(`= ${d?.refills?.servedRefillsTotal}`);
  if (near(d?.refills?.servedRefillsByName?.Soup, 1)) ok("refills.servedRefillsByName.Soup == 1"); else bad(`= ${d?.refills?.servedRefillsByName?.Soup}`);

  // Ticket C: package, cancelled 1.
  console.log("\nCancel:");
  const C: any = {
    type: "package", qty: 1, createdAtClientMs: MS,
    status: "cancelled", qtyCancelled: 1, cancelledAtClientMs: MS,
    analyticsServedQty: 0, analyticsCancelledQty: 0, analyticsDurationMs: 0, analyticsDurationCount: 0,
  };
  await applyTicket(C);
  d = await dayDoc();
  if (near(d?.kitchen?.cancelledCountByType?.package, 1)) ok("cancelledCountByType.package == 1"); else bad(`= ${d?.kitchen?.cancelledCountByType?.package}`);
  if (near(d?.kitchen?.servedCountByType?.package, 5)) ok("served package unaffected by cancel (still 5)"); else bad(`= ${d?.kitchen?.servedCountByType?.package}`);
}

async function cleanup() {
  for (const sub of ["analytics", "analyticsMonths", "analyticsYears"]) {
    const snap = await db.collection(`stores/${RUN}/${sub}`).get();
    for (const dd of snap.docs) await dd.ref.delete();
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
