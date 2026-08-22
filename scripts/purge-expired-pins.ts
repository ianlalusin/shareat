/**
 * Delete expired customer access PINs from the root `pinRegistry` collection.
 *
 * Thin CLI wrapper: the query, batching and safety rails live in
 * `src/lib/server/retention/purge-pins.ts`, shared verbatim with
 * `src/app/api/cron/purge-expired-pins/route.ts` so the manual tool and the
 * scheduled job cannot drift apart.
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
import { purgeExpiredPins, DEFAULT_GRACE_DAYS } from "../src/lib/server/retention/purge-pins";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const WRITE = args.write === "true";
const GRACE_DAYS = Number(args.days ?? DEFAULT_GRACE_DAYS);

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

  const result = await purgeExpiredPins(db, {
    nowMs: Date.now(),
    write: WRITE,
    graceDays: GRACE_DAYS,
  });

  console.log(`[pins] mode=${WRITE ? "WRITE" : "DRY RUN"} grace=${result.graceDays}d`);
  console.log(`[pins] cutoff=${new Date(result.cutoffMs).toISOString()}`);
  console.log(
    `[pins] registry total=${result.total}  expired past grace=${result.candidates}  keeping=${result.total - result.candidates}`,
  );

  if (!WRITE) {
    const preview = await db
      .collection("pinRegistry")
      .where("expiresAtMs", "<", result.cutoffMs)
      .orderBy("expiresAtMs", "asc")
      .limit(5)
      .get();
    console.log("[pins] sample of what would be deleted:");
    for (const d of preview.docs) {
      const v = d.data() as any;
      console.log(
        `  ${d.id}  status=${v.status ?? "(none)"}  expired=${v.expiresAtMs ? new Date(v.expiresAtMs).toISOString() : "(none)"}  store=${v.storeId ?? "(none)"}`,
      );
    }
    console.log(`[pins] dry run — nothing deleted. Re-run with --write to delete ${result.candidates}.`);
    return;
  }

  const remaining = (await db.collection("pinRegistry").count().get()).data().count;
  console.log(`[pins] done. deleted=${result.deleted}  registry now=${remaining}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
