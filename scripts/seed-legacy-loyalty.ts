/**
 * Seed the parked legacy loyalty customers from the exported claim list.
 *
 * Thin CLI wrapper: the idempotency rules and batching live in
 * `src/lib/server/legacy-loyalty.ts`, shared with the /api/loyalty/legacy
 * routes so the importer and the staff panel cannot drift apart.
 *
 * The export file holds real customer names and stays OUT of the repo — pass
 * its path explicitly every time.
 *
 * Usage (from the project root):
 *   npx tsx scripts/seed-legacy-loyalty.ts --file="C:\path\Legacy EPOINTS Claim List.json"
 *   npx tsx scripts/seed-legacy-loyalty.ts --file=... --write
 *
 * Credentials: reuses FIREBASE_ADMIN_SA_PATH from .env.local. Read-only until
 * --write is passed. Re-running is safe: already-claimed rows are skipped, so
 * a corrected export can be re-imported without undoing staff verification.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  LEGACY_COLLECTION,
  seedLegacyCustomers,
  type LegacyLoyaltySeedRow,
} from "../src/lib/server/legacy-loyalty";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    // Windows paths contain no '=' but names might; rejoin defensively.
    return [k, rest.length ? rest.join("=") : "true"];
  }),
);
const WRITE = args.write === "true";
const FILE = typeof args.file === "string" && args.file !== "true" ? args.file : "";

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

type ClaimList = {
  source?: string;
  conversion?: string;
  customers?: LegacyLoyaltySeedRow[];
};

async function main() {
  if (!FILE) {
    console.error("Missing --file=<path to Legacy EPOINTS Claim List.json>");
    process.exit(2);
  }

  const parsed = JSON.parse(readFileSync(resolve(FILE), "utf8")) as ClaimList;
  const customers = Array.isArray(parsed.customers) ? parsed.customers : [];
  if (!customers.length) throw new Error(`No customers[] in ${FILE}`);

  const source = String(parsed.source || FILE);

  loadEnvLocal();
  const db = initAdmin();

  const result = await seedLegacyCustomers(db, customers, { source, write: WRITE });

  console.log(`[legacy] mode=${WRITE ? "WRITE" : "DRY RUN"}  collection=${LEGACY_COLLECTION}`);
  console.log(`[legacy] source=${source}`);
  if (parsed.conversion) console.log(`[legacy] conversion=${parsed.conversion}`);
  console.log(
    `[legacy] file rows=${customers.length}  create=${result.created}  refresh=${result.updated}  skip (already claimed)=${result.skippedClaimed}`,
  );

  const pointsInFile = customers.reduce((sum, c) => sum + (Number(c.newPoints) || 0), 0);
  console.log(`[legacy] points in file=${pointsInFile} (nothing is transferred by this script)`);

  if (!WRITE) {
    // Ids only, never names: the console scrollback is not a place for the
    // customer list to leak into.
    const sample = customers.slice(0, 3).map((c) => c.id);
    console.log(`[legacy] sample ids: ${sample.join(", ")}`);
    console.log(
      `[legacy] dry run — nothing written. Re-run with --write to upsert ${result.created + result.updated}.`,
    );
    return;
  }

  const total = (await db.collection(LEGACY_COLLECTION).count().get()).data().count;
  console.log(`[legacy] done. collection now=${total}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
