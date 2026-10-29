/**
 * Audit B20 (2026-10-29): move legacy local-profile passcode hashes from
 * stores/{storeId}/serverProfiles/{id}.passcodeHash (readable by every staffer
 * of the store) into stores/{storeId}/serverProfileSecrets/{id} (Admin SDK
 * only), and delete the readable field.
 *
 * Thin CLI wrapper; the per-profile logic lives in
 * src/lib/server/server-profile-secrets-migrate.ts (unit tested).
 *
 * DRY RUN BY DEFAULT. Nothing is written without --commit.
 *
 *   npx tsx scripts/migrate-server-profile-secrets.ts                 # preview, all stores
 *   npx tsx scripts/migrate-server-profile-secrets.ts --store=<id>    # preview, one store
 *   npx tsx scripts/migrate-server-profile-secrets.ts --commit        # apply
 *
 * Nobody's passcode changes: moved hashes keep working and are re-wrapped with
 * scrypt on the next sign-in. AFTER a committed run reports zero
 * "copy-and-strip" on a re-run, set SERVER_PROFILE_REQUIRE_SECRET_DOC=true on
 * the server so profiles without a secret doc fail closed.
 *
 * Credentials: FIREBASE_ADMIN_SA_PATH from .env.local (prints the project id).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { migrateServerProfileSecretsForStore } from "../src/lib/server/server-profile-secrets-migrate";

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
const ONLY_STORE = (argv.find((a) => a.startsWith("--store=")) || "").split("=")[1] || "";

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
  console.log(COMMIT ? "MODE: COMMIT (writes)" : "MODE: DRY RUN (no writes) - pass --commit to apply");

  const storeIds = ONLY_STORE ? [ONLY_STORE] : (await db.collection("stores").listDocuments()).map((d) => d.id);
  const totals = { "copy-and-strip": 0, "strip-only": 0, "already-migrated": 0, "no-secret": 0 };

  for (const storeId of storeIds) {
    const r = await migrateServerProfileSecretsForStore(db, storeId, { commit: COMMIT });
    if (r.scanned === 0) continue;
    console.log(
      `  ${storeId}: ${r.scanned} profiles | move ${r.actions["copy-and-strip"].length}` +
        ` | strip-only ${r.actions["strip-only"].length}` +
        ` | already ok ${r.actions["already-migrated"].length}` +
        ` | NO SECRET ${r.actions["no-secret"].length}`
    );
    if (r.actions["no-secret"].length) {
      console.log(`    no-secret profile ids (need a manager passcode reset): ${r.actions["no-secret"].join(", ")}`);
    }
    for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += r.actions[k].length;
  }

  console.log(`\n${COMMIT ? "Done" : "Dry run complete"}: ${JSON.stringify(totals)}`);
  if (!COMMIT) console.log("Re-run with --commit to apply.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
