/**
 * Credit (or debit) a loyalty card's points balance outside a sale.
 *
 * Built for the 2026-09 legacy EPOINTS migration: the converted total for
 * every parked Google-Sheet customer is loaded onto the owner's card once,
 * and the owner then hands each customer their share through the existing
 * Hub transfer after the cashier has verified them against the claim sheet.
 * A negative --points reverses whatever is left unclaimed at the deadline.
 *
 * Writes, in one transaction, the same three things every other points
 * movement writes: the balance on customers/<phone>, a pointsLedger entry
 * (type "adjust", already in the ledger's TS union so the /pins customer
 * view renders it), and loyaltyStats/global.totalPointsOutstanding.
 *
 * Usage (from the project root):
 *   npx tsx scripts/credit-loyalty-points.ts --phone=+639XXXXXXXXX --points=287 --note="Legacy EPOINTS import"
 *   npx tsx scripts/credit-loyalty-points.ts --phone=... --points=-40 --note="Unclaimed legacy points removed" --write
 *   add --rename="SharEat" to also change the card's display name in the same transaction
 *
 * Dry run unless --write is passed. Refuses to take a balance negative.
 * Credentials: FIREBASE_ADMIN_SA_PATH from .env.local.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k, rest.length ? rest.join("=") : "true"];
  }),
);
const WRITE = args.write === "true";
const PHONE = String(args.phone || "").trim();
const POINTS = Number(args.points);
const NOTE = String(args.note || "").trim();
/** Optional: also set the card's display name (what transfer recipients see as the sender). */
const RENAME = typeof args.rename === "string" && args.rename !== "true" ? args.rename.trim() : "";

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

function maskPhone(p: string) {
  return p.replace(/\d(?=\d{3})/g, "*");
}

async function main() {
  if (!/^\+63\d{10}$/.test(PHONE)) throw new Error("--phone must be E.164 PH format, e.g. +639171234567 (the customers/<phone> doc id).");
  if (!Number.isInteger(POINTS) || POINTS === 0) throw new Error("--points must be a non-zero integer.");
  if (!NOTE) throw new Error("--note is required; it is stored on the ledger entry.");

  loadEnvLocal();
  const db = initAdmin();

  const customerRef = db.doc(`customers/${PHONE}`);
  const snap = await customerRef.get();
  if (!snap.exists) throw new Error(`No loyalty card at customers/${maskPhone(PHONE)}.`);
  const c = snap.data() as Record<string, any>;
  const before = Number(c.pointsBalance || 0);
  const after = before + POINTS;

  console.log(`[credit] card=${maskPhone(PHONE)} name="${c.name ?? ""}" balance=${before} -> ${after} (${POINTS > 0 ? "+" : ""}${POINTS})`);
  console.log(`[credit] note="${NOTE}"`);
  if (RENAME) console.log(`[credit] rename "${c.name ?? ""}" -> "${RENAME}"`);
  if (after < 0) throw new Error(`Refusing: balance would go negative (${after}).`);

  if (!WRITE) {
    console.log("[credit] dry run — nothing written. Re-run with --write to apply.");
    return;
  }

  const ledgerRef = customerRef.collection("pointsLedger").doc();
  const statsRef = db.doc("loyaltyStats/global");
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(customerRef);
    const live = Number(fresh.data()?.pointsBalance || 0);
    if (live + POINTS < 0) throw new Error(`Refusing: live balance ${live} would go negative.`);
    tx.update(customerRef, {
      pointsBalance: FieldValue.increment(POINTS),
      updatedAt: FieldValue.serverTimestamp(),
      ...(RENAME ? { name: RENAME } : {}),
    });
    tx.set(ledgerRef, {
      type: "adjust",
      points: POINTS,
      amount: 0,
      storeId: "",
      storeName: "",
      sessionId: "",
      note: NOTE,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: "script:credit-loyalty-points",
    });
    tx.set(statsRef, { totalPointsOutstanding: FieldValue.increment(POINTS), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  const done = await customerRef.get();
  console.log(`[credit] done. ledger=${ledgerRef.id} balance now=${Number(done.data()?.pointsBalance || 0)}`);
}

main().catch((e) => {
  console.error("FATAL", e?.message ?? e);
  process.exit(1);
});
