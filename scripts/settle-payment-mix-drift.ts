/**
 * Settle the dashboard "Payment mix mismatch vs Net Sales" drift caused by an
 * item voided on an already-settled receipt (old correction flow left the
 * payment mix at the original amount while the bill total dropped).
 *
 * It does NOT mutate the source receipt. It rebuilds the affected day's analytics
 * from receipts — the rebuild core (`correctedByMethodForReceipt`) nets the
 * recorded `change` out of cash for these old-style receipts, so payment mix
 * reconciles to net sales again — then rebuilds the dashboard preset tiles.
 *
 * Usage (run from the project root):
 *   npx tsx scripts/settle-payment-mix-drift.ts                 # dry-run (inspect only)
 *   npx tsx scripts/settle-payment-mix-drift.ts --apply         # rebuild day + presets
 *   ...optional: --store=lipa --date=2026-06-12 --receipt=4999
 *
 * Credentials: reuses FIREBASE_ADMIN_SA_PATH from .env.local (same as the app's
 * Admin SDK). Read-only until --apply is passed.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Receipt, KitchenTicket, Store } from "../src/lib/types";
import {
  aggregateDailyMetrics,
  presetRanges,
  sumDailyBodyInto,
  topRefillsFrom,
  topAddonsFrom,
  correctedByMethodForReceipt,
} from "../src/lib/analytics/backfill-core";

// ---- args ----
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const APPLY = args.apply === "true";
const STORE_NEEDLE = args.store ?? "lipa";
const STORE_ID_ARG = args.storeId as string | undefined;
const DATE_STR = args.date ?? "2026-06-12";
const RECEIPT_NO = args.receipt ?? "4999";

const peso = (n: number) => `₱${(Number(n) || 0).toFixed(2)}`;
const sumVals = (o: Record<string, number> = {}) => Object.values(o).reduce((s, v) => s + (Number(v) || 0), 0);

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

async function resolveStore(db: Firestore): Promise<{ id: string; name: string }> {
  if (STORE_ID_ARG) {
    const s = await db.doc(`stores/${STORE_ID_ARG}`).get();
    if (!s.exists) throw new Error(`Store ${STORE_ID_ARG} not found.`);
    return { id: s.id, name: (s.data() as any)?.name ?? STORE_ID_ARG };
  }
  const snap = await db.collection("stores").get();
  const matches = snap.docs.filter((d) =>
    String((d.data() as any)?.name || "").toLowerCase().includes(STORE_NEEDLE.toLowerCase()),
  );
  if (matches.length === 0) throw new Error(`No store name contains "${STORE_NEEDLE}".`);
  if (matches.length > 1) {
    console.log("Multiple matches:", matches.map((m) => `${m.id} = ${(m.data() as any)?.name}`).join(", "));
    throw new Error(`Ambiguous store "${STORE_NEEDLE}"; pass --storeId=<id>.`);
  }
  return { id: matches[0].id, name: (matches[0].data() as any)?.name ?? matches[0].id };
}

function dayBounds(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  const end = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  return { start, end };
}

async function dayReconciliation(db: Firestore, storeId: string, dayStartMs: number) {
  const snap = await db
    .collection(`stores/${storeId}/analytics`)
    .where("meta.dayStartMs", "==", dayStartMs)
    .get();
  let net = 0;
  let mop = 0;
  snap.forEach((d) => {
    const x: any = d.data();
    net += Number(x?.payments?.totalGross ?? 0);
    mop += sumVals(x?.payments?.byMethod ?? {});
  });
  return { net, mop, diff: Math.abs(mop - net), docs: snap.size };
}

// ---- inline ports of the server rebuilds (admin SDK + pure core) ----
async function rebuildDaily(db: Firestore, storeId: string, start: Date, end: Date) {
  const startInclusive = new Date(start);
  const endExclusive = new Date(end);
  endExclusive.setHours(0, 0, 0, 0);
  endExclusive.setDate(endExclusive.getDate() + 1);

  const storeSnap = await db.doc(`stores/${storeId}`).get();
  if (!storeSnap.exists) throw new Error("Store not found.");
  const store = storeSnap.data() as Store;

  const ticketsStart = new Date(startInclusive.getTime() - 24 * 60 * 60 * 1000);
  const ticketsEnd = new Date(endExclusive.getTime() + 24 * 60 * 60 * 1000);

  const [receiptsSnap, ticketsSnap, sessionsSnap] = await Promise.all([
    db.collection(`stores/${storeId}/receipts`)
      .where("createdAt", ">=", Timestamp.fromDate(startInclusive))
      .where("createdAt", "<", Timestamp.fromDate(endExclusive))
      .orderBy("createdAt", "asc")
      .get(),
    db.collectionGroup("kitchentickets")
      .where("storeId", "==", storeId)
      .where("createdAt", ">=", Timestamp.fromDate(ticketsStart))
      .where("createdAt", "<", Timestamp.fromDate(ticketsEnd))
      .get(),
    db.collection(`stores/${storeId}/sessions`)
      .where("verifiedAt", ">=", Timestamp.fromDate(startInclusive))
      .where("verifiedAt", "<", Timestamp.fromDate(endExclusive))
      .get(),
  ]);

  const receipts = receiptsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Receipt));
  const tickets = ticketsSnap.docs.map((d) => d.data() as KitchenTicket);
  const verifiedSessions = sessionsSnap.docs.map((d) => d.data() as any);

  const aggregates = aggregateDailyMetrics({
    receipts,
    tickets,
    verifiedSessions,
    store,
    storeId,
    startInclusiveMs: startInclusive.getTime(),
    endExclusiveMs: endExclusive.getTime(),
  });

  const batch = db.batch();
  for (const [dayId, data] of aggregates.entries()) {
    (data.meta as any).updatedAt = FieldValue.serverTimestamp();
    (data.meta as any).backfilledAt = FieldValue.serverTimestamp();
    (data.meta as any).source = "settle-payment-mix-drift";
    batch.set(db.doc(`stores/${storeId}/analytics/${dayId}`), data as any, { merge: false });
  }
  await batch.commit();
  return { days: aggregates.size, receipts: receipts.length, tickets: tickets.length };
}

async function rebuildPresets(db: Firestore, storeId: string) {
  const ranges = presetRanges(new Date());
  const batch = db.batch();
  for (const { presetId, start, end } of ranges) {
    const snap = await db
      .collection(`stores/${storeId}/analytics`)
      .where("meta.dayStartMs", ">=", start.getTime())
      .where("meta.dayStartMs", "<=", end.getTime())
      .get();
    const agg: any = {};
    snap.forEach((d) => sumDailyBodyInto(agg, d.data()));
    const presetData = {
      ...agg,
      refills: { ...(agg.refills ?? {}), topRefillsByQty: topRefillsFrom(agg) },
      sales: { ...(agg.sales ?? {}), topAddonsByQty: topAddonsFrom(agg) },
      meta: {
        presetId,
        storeId,
        source: "settle-payment-mix-drift-presets",
        updatedAt: FieldValue.serverTimestamp(),
        rangeStartMs: start.getTime(),
        rangeEndMs: end.getTime(),
      },
    };
    batch.set(db.doc(`stores/${storeId}/dashPresets/${presetId}`), presetData);
  }
  await batch.commit();
  return { presets: ranges.length };
}

async function main() {
  loadEnvLocal();
  const db = initAdmin();
  const { start, end } = dayBounds(DATE_STR);
  const dayStartMs = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0).getTime();

  console.log(`\n=== Settle payment-mix drift ===`);
  console.log(`mode: ${APPLY ? "APPLY (writes)" : "DRY-RUN (read-only)"} | date: ${DATE_STR} | receipt: ${RECEIPT_NO}`);

  const store = await resolveStore(db);
  console.log(`store: ${store.name} (${store.id})\n`);

  // --- inspect the source receipt ---
  const rq = await db.collection(`stores/${store.id}/receipts`).where("receiptNumber", "==", RECEIPT_NO).get();
  if (rq.empty) {
    console.log(`! receipt #${RECEIPT_NO} not found by receiptNumber (it may be archived or numbered differently).`);
  }
  rq.forEach((doc) => {
    const r = doc.data() as Receipt;
    const mop = (r.analytics as any)?.mop ?? {};
    const sumMop = sumVals(mop);
    const grand = Number((r.analytics as any)?.grandTotal ?? r.total ?? 0);
    const fixed = correctedByMethodForReceipt(r, mop);
    console.log(`receipt #${r.receiptNumber} (${doc.id})`);
    console.log(`  status=${r.status} isEdited=${r.isEdited ?? false} editVersion=${r.editVersion ?? 0}`);
    console.log(`  grandTotal=${peso(grand)} totalPaid=${peso(r.totalPaid)} change=${peso(r.change)}`);
    console.log(`  mop (recorded)=${JSON.stringify(mop)} sum=${peso(sumMop)}`);
    console.log(`  drift (sumMop - grandTotal)=${peso(sumMop - grand)}`);
    console.log(`  mop AFTER rebuild correction=${JSON.stringify(fixed)} sum=${peso(sumVals(fixed))}  (should equal grandTotal)`);
  });

  // --- before reconciliation for the day ---
  const before = await dayReconciliation(db, store.id, dayStartMs);
  console.log(`\n[${DATE_STR}] daily docs=${before.docs} netSales=${peso(before.net)} paymentMix=${peso(before.mop)} drift=${peso(before.diff)}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN only. Re-run with --apply to rebuild the day + presets.\n`);
    return;
  }

  console.log(`\nRebuilding daily analytics for ${DATE_STR}...`);
  const d = await rebuildDaily(db, store.id, start, end);
  console.log(`  rebuilt ${d.days} day(s) from ${d.receipts} receipt(s), ${d.tickets} ticket(s).`);

  console.log(`Rebuilding dashboard presets...`);
  const p = await rebuildPresets(db, store.id);
  console.log(`  rebuilt ${p.presets} preset(s).`);

  const after = await dayReconciliation(db, store.id, dayStartMs);
  console.log(`\n[${DATE_STR}] AFTER  netSales=${peso(after.net)} paymentMix=${peso(after.mop)} drift=${peso(after.diff)}`);
  console.log(after.diff <= 2 ? `\n✅ Drift settled (within ₱2 tolerance).\n` : `\n⚠️ Drift still ${peso(after.diff)} — investigate other receipts on this day.\n`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("\n❌ Failed:", e?.message || e);
  process.exit(1);
});
