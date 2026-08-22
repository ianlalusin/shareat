/**
 * Delete expired customer access PINs from the root `pinRegistry` collection.
 *
 * A PIN has a 2-hour TTL (src/app/api/pins/issue/route.ts:11) and is dead the
 * moment its session closes — it feeds no aggregate and carries no analytic
 * value, so unlike kitchen tickets this needs no retention horizon and no
 * rebuild guard. `CUSTOMER/src/app/api/admin/cleanup-archived-pins/route.ts`
 * was built to sweep the archived ones and has evidently never been run: as of
 * 2026-08-22 there were 5,296 live pins, 5,277 of them already archived.
 *
 * Filtering on `expiresAtMs` rather than `status` catches both the archived
 * population and pins that expired without ever being archived, in one
 * single-field query that needs no composite index.
 *
 * A GRACE_DAYS window is kept past expiry so the /admin pin list stays useful
 * for support lookups ("what PIN did table 5 get on Tuesday?").
 *
 * Usage (from the project root):
 *   npx tsx scripts/purge-expired-pins.ts            # dry run, counts only
 *   npx tsx scripts/purge-expired-pins.ts --write    # actually delete
 *   npx tsx scripts/purge-expired-pins.ts --days=30  # override the grace window
 *
 * Credentials: reuses FIREBASE_ADMIN_SA_PATH from .env.local. Read-only until
 * --write is passed.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const WRITE = args.write === "true";
const GRACE_DAYS = Number(args.days ?? 7);

const DAY_MS = 86_400_000;
const DELETE_BATCH = 500;

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

async function main() {
  loadEnvLocal();
  const db = initAdmin();

  const nowMs = Date.now();
  const cutoff = nowMs - GRACE_DAYS * DAY_MS;

  const base = db
    .collection("pinRegistry")
    .where("expiresAtMs", "<", cutoff)
    .orderBy("expiresAtMs", "asc");

  const total = (await db.collection("pinRegistry").count().get()).data().count;
  const candidates = (await base.count().get()).data().count;

  console.log(`[pins] mode=${WRITE ? "WRITE" : "DRY RUN"} grace=${GRACE_DAYS}d`);
  console.log(`[pins] cutoff=${new Date(cutoff).toISOString()}`);
  console.log(`[pins] registry total=${total}  expired past grace=${candidates}  keeping=${total - candidates}`);

  // Sanity check: never sweep the whole collection. If every pin looks expired
  // the field is wrong or the clock is, and deleting all of them would take
  // live sessions' PINs with it.
  if (candidates > 0 && candidates === total) {
    throw new Error("Every pin matched the expiry filter — refusing to run. Check expiresAtMs and the grace window.");
  }

  if (!WRITE) {
    const preview = await base.limit(5).get();
    console.log(`[pins] sample of what would be deleted:`);
    for (const d of preview.docs) {
      const v = d.data() as any;
      console.log(
        `  ${d.id}  status=${v.status ?? "(none)"}  expired=${v.expiresAtMs ? new Date(v.expiresAtMs).toISOString() : "(none)"}  store=${v.storeId ?? "(none)"}`,
      );
    }
    console.log(`[pins] dry run — nothing deleted. Re-run with --write to delete ${candidates}.`);
    return;
  }

  let deleted = 0;
  for (;;) {
    const snap = await base.limit(DELETE_BATCH).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    deleted += snap.size;
    console.log(`[pins] deleted ${deleted}/${candidates}`);
    if (snap.size < DELETE_BATCH) break;
  }

  const remaining = (await db.collection("pinRegistry").count().get()).data().count;
  console.log(`[pins] done. deleted=${deleted}  registry now=${remaining}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
