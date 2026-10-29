/**
 * Audit B05 (2026-10-29): move Sharelebrator password hashes from
 * customers/{phone}.passwordHash to customers/{phone}/secrets/auth, which no
 * client rule can read. Logic: src/lib/server/customer-secrets-migrate.ts.
 *
 * DRY RUN BY DEFAULT. Nothing is written without --commit.
 *
 *   npx tsx scripts/migrate-customer-secrets.ts                          # preview copy
 *   npx tsx scripts/migrate-customer-secrets.ts --commit                 # phase 1: copy (legacy field kept)
 *   npx tsx scripts/migrate-customer-secrets.ts --remove-legacy          # preview strip
 *   npx tsx scripts/migrate-customer-secrets.ts --remove-legacy --commit # phase 2: delete legacy field
 *
 * Phase 1 is safe at any time. Phase 2 LOCKS EVERY CUSTOMER OUT unless the
 * CUSTOMER app's login/link-session/update-profile/signup routes already read
 * and write customers/{phone}/secrets/auth — run it only after that ships.
 *
 * Credentials: FIREBASE_ADMIN_SA_PATH from .env.local (prints the project id).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { migrateCustomerSecrets } from "../src/lib/server/customer-secrets-migrate";
import { maskPhone } from "../src/lib/loyalty/session-link";

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
const REMOVE_LEGACY = argv.includes("--remove-legacy");

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

function initAdmin() {
  if (getApps().length) return;
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

async function main() {
  loadEnvLocal();
  initAdmin();
  const db = getFirestore();
  console.log(
    `MODE: ${COMMIT ? "COMMIT (writes)" : "DRY RUN (no writes)"} | PHASE: ${REMOVE_LEGACY ? "2 strip legacy field" : "1 copy"}`
  );

  const r = await migrateCustomerSecrets(db, { commit: COMMIT, removeLegacy: REMOVE_LEGACY });
  console.log(`Scanned ${r.scanned} customers: ${JSON.stringify(r.counts)}`);
  if (r.conflicts.length) {
    console.log(`Conflicts (secret != legacy, left untouched): ${r.conflicts.map(maskPhone).join(", ")}`);
  }
  if (!COMMIT) console.log("Re-run with --commit to apply.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
