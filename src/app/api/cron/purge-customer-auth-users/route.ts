import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import {
  purgeCustomerAuthUsers,
  DEFAULT_MAX_IDLE_HOURS,
  type PurgeCandidate,
} from "@/lib/server/retention/purge-customer-auth-users";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily sweep of idle customer Firebase Auth users.
 *
 * `signInWithCustomToken` auto-creates an Auth user per `cust_part_*` /
 * legacy `cust_*` uid and nothing has ever deleted one, so the pool grows
 * without bound. Anything idle past the window is a dead session identity —
 * see src/lib/server/retention/purge-customer-auth-users.ts for the census
 * and for why staff (email) and loyalty (phone) accounts are excluded
 * structurally rather than by an allowlist.
 *
 * Reports only unless `?write=1`, so the job can be scheduled and observed for
 * a cycle before it is armed. `?hours=` overrides the idle window.
 *
 * An armed run backs the doomed records up to Firestore first and deletes
 * nothing if that write fails — see `backupToFirestore` below.
 *
 * Scheduled by Google Cloud Scheduler with header
 * Authorization: Bearer ${CRON_SECRET}. See docs/CRON.md.
 */

/**
 * Firestore caps a document at 1 MiB. A `PurgeCandidate` is a uid plus three
 * ISO timestamps — call it ~150 bytes with field names, so ~7,000 of them
 * would fit. 4,000 leaves better than a 40% margin against a future field or
 * a longer uid scheme, and the very first armed run is expected to carry
 * ~5,600 records, i.e. already past one doc.
 */
const MAX_RECORDS_PER_DOC = 4000;

/** Only used to restate the cutoff in the backup doc; the sweep owns the real one. */
const HOUR_MS = 3_600_000;

/**
 * Persist every doomed record before the sweep deletes one.
 *
 * Lives under `system/*`, which is excluded from both client catch-alls in
 * `firestore.rules` — this is a server-only audit trail of identities that no
 * longer exist, and Firebase Auth has no undelete, so it is the only record
 * that a given uid was ever real.
 *
 * One run is one parent doc keyed by its ISO timestamp with colons swapped for
 * dashes (a Firestore document id may not contain `/`, and colons make the id
 * awkward to paste into a console URL). Over `MAX_RECORDS_PER_DOC` records the
 * payload moves into numbered `chunks/<n>` subcollection docs and the parent
 * keeps only the counters, so no single doc ever approaches the 1 MiB limit.
 */
async function backupToFirestore(
  records: PurgeCandidate[],
  meta: { ranAtMs: number; cutoffMs: number; maxIdleHours: number },
): Promise<string> {
  const db = getAdminDb();
  const runId = new Date(meta.ranAtMs).toISOString().replace(/:/g, "-");
  const ref = db.collection("system").doc("authUserPurgeRuns").collection("runs").doc(runId);

  const base = {
    ranAtMs: meta.ranAtMs,
    cutoffMs: meta.cutoffMs,
    maxIdleHours: meta.maxIdleHours,
    count: records.length,
  };

  if (records.length <= MAX_RECORDS_PER_DOC) {
    await ref.set({ ...base, chunked: false, records });
    return ref.path;
  }

  const chunkCount = Math.ceil(records.length / MAX_RECORDS_PER_DOC);
  // Parent first, so a run interrupted mid-backup still leaves a findable
  // header saying how many chunks were meant to exist.
  await ref.set({ ...base, chunked: true, chunkCount });
  for (let n = 0; n < chunkCount; n++) {
    const slice = records.slice(n * MAX_RECORDS_PER_DOC, (n + 1) * MAX_RECORDS_PER_DOC);
    await ref.collection("chunks").doc(String(n)).set({
      ranAtMs: meta.ranAtMs,
      index: n,
      count: slice.length,
      records: slice,
    });
  }
  return ref.path;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron/purge-customer-auth-users] CRON_SECRET env var not set");
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const write = params.get("write") === "1";
  const hoursParam = Number(params.get("hours"));
  const maxIdleHours = Number.isFinite(hoursParam) && hoursParam > 0 ? hoursParam : DEFAULT_MAX_IDLE_HOURS;

  const ranAtMs = Date.now();
  const cutoffMs = ranAtMs - maxIdleHours * HOUR_MS;
  // A holder, not a bare `let`: the only writer is the backup callback, and a
  // `let` assigned solely inside a closure keeps its initializer's narrowing
  // at the read sites below.
  const backup = { path: null as string | null };

  try {
    const result = await purgeCustomerAuthUsers(getAdminAuth(), {
      nowMs: ranAtMs,
      write,
      maxIdleHours,
      backup: write
        ? async (records) => {
            backup.path = await backupToFirestore(records, { ranAtMs, cutoffMs, maxIdleHours });
          }
        : undefined,
    });
    console.log(
      `[cron/purge-customer-auth-users] write=${write} hours=${result.maxIdleHours} scanned=${result.scanned} customerUsers=${result.customerUsers} candidates=${result.candidates} backedUp=${result.backedUp} backupPath=${backup.path ?? "-"} aborted=${result.aborted ?? "-"} deleted=${result.deleted} failures=${result.failures}`,
    );
    // A backup failure aborts the delete; surface it as a 500 so the Cloud
    // Scheduler run history shows red instead of a green run that did nothing.
    if (result.aborted) {
      return NextResponse.json({ ok: false, write, ...result, backupPath: backup.path }, { status: 500 });
    }
    return NextResponse.json({ ok: true, write, ...result, backupPath: backup.path });
  } catch (err: any) {
    console.error("[cron/purge-customer-auth-users] failed:", err);
    return NextResponse.json(
      { error: err?.message || "Customer auth purge cron failed." },
      { status: 500 },
    );
  }
}
