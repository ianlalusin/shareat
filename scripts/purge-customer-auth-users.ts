/**
 * Delete idle customer Firebase Auth users (`cust_part_*` and legacy `cust_*`).
 *
 * Thin CLI wrapper: the paging, candidate predicate, chunking and rate-limit
 * pause all live in `src/lib/server/retention/purge-customer-auth-users.ts`,
 * shared verbatim with
 * `src/app/api/cron/purge-customer-auth-users/route.ts` so the manual tool and
 * the scheduled job cannot drift apart.
 *
 * Usage (from the project root):
 *   npx tsx scripts/purge-customer-auth-users.ts             # dry run, counts only
 *   npx tsx scripts/purge-customer-auth-users.ts --write     # actually delete
 *   npx tsx scripts/purge-customer-auth-users.ts --hours=72  # override the idle window
 *
 * Credentials: reuses FIREBASE_ADMIN_SA_PATH from .env.local. Read-only until
 * --write is passed. A full armed run walks the whole user pool and then
 * deletes in 1,000-uid batches at 1 QPS, so budget ~1s per thousand.
 *
 * An armed run first writes every doomed record to
 * `./.purge-backups/auth-users-<timestamp>.json` and deletes nothing at all if
 * that write fails. Firebase Auth has no undelete, so the JSON file is the only
 * record these identities existed. `.purge-backups/` is gitignored — the files
 * are local operator output, not project source.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import {
  purgeCustomerAuthUsers,
  isCustomerAuthUser,
  lastActivityMs,
  DEFAULT_MAX_IDLE_HOURS,
} from "../src/lib/server/retention/purge-customer-auth-users";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const WRITE = args.write === "true";
const MAX_IDLE_HOURS = Number(args.hours ?? DEFAULT_MAX_IDLE_HOURS);

/** Relative to the project root, gitignored. One JSON file per armed run. */
const BACKUP_DIR = ".purge-backups";

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

function initAdmin(): Auth {
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
  return getAuth();
}

/** Up to `limit` uids the sweep would take, using the sweep's own predicate. */
async function sampleCandidates(auth: Auth, cutoffMs: number, limit: number) {
  const out: Array<{ uid: string; lastActive: string }> = [];
  let pageToken: string | undefined = undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (!isCustomerAuthUser(user)) continue;
      const activeAt = lastActivityMs(user);
      if (!Number.isFinite(activeAt) || activeAt >= cutoffMs) continue;
      out.push({ uid: user.uid, lastActive: new Date(activeAt).toISOString() });
      if (out.length >= limit) return out;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return out;
}

async function main() {
  loadEnvLocal();
  const auth = initAdmin();

  const ranAtMs = Date.now();
  // A holder, not a bare `let`: the only writer is the backup callback, and a
  // `let` assigned solely inside a closure keeps its initializer's narrowing.
  const backup = { path: null as string | null };

  const result = await purgeCustomerAuthUsers(auth, {
    nowMs: ranAtMs,
    write: WRITE,
    maxIdleHours: MAX_IDLE_HOURS,
    backup: WRITE
      ? async (records) => {
          const dir = resolve(process.cwd(), BACKUP_DIR);
          mkdirSync(dir, { recursive: true });
          // Colons are illegal in a Windows filename, so the ISO stamp is
          // written with the same colon->dash swap the cron backup doc id uses.
          const stamp = new Date(ranAtMs).toISOString().replace(/:/g, "-");
          const file = resolve(dir, `auth-users-${stamp}.json`);
          writeFileSync(
            file,
            JSON.stringify(
              { ranAtMs, cutoffMs: ranAtMs - MAX_IDLE_HOURS * 3_600_000, maxIdleHours: MAX_IDLE_HOURS, count: records.length, records },
              null,
              2,
            ),
            "utf8",
          );
          backup.path = file;
          console.log(`[authusers] backup written: ${file} (${records.length} record(s))`);
        }
      : undefined,
  });

  console.log(`[authusers] mode=${WRITE ? "WRITE" : "DRY RUN"} maxIdle=${result.maxIdleHours}h`);
  console.log(`[authusers] cutoff=${new Date(result.cutoffMs).toISOString()}`);
  console.log(
    `[authusers] auth pool total=${result.scanned}  customer identities=${result.customerUsers}  idle past cutoff=${result.candidates}  keeping=${result.scanned - result.candidates}`,
  );

  if (!WRITE) {
    const preview = await sampleCandidates(auth, result.cutoffMs, 5);
    console.log("[authusers] sample of what would be deleted:");
    for (const p of preview) {
      console.log(`  ${p.uid}  lastActive=${p.lastActive}`);
    }
    if (!preview.length) console.log("  (none)");
    console.log(
      `[authusers] dry run — nothing deleted. Re-run with --write to delete ${result.candidates}.`,
    );
    return;
  }

  if (result.aborted === "backup_failed") {
    console.error(
      `[authusers] ABORTED — the backup to ${BACKUP_DIR}/ failed, so nothing was deleted. ` +
        `Fix the backup destination and re-run; ${result.candidates} candidate(s) are still there.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[authusers] done. backedUp=${result.backedUp} backup=${backup.path ?? "(none)"} deleted=${result.deleted}  failures=${result.failures}`,
  );
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
