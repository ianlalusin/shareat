import type { Auth, UserRecord } from "firebase-admin/auth";

/**
 * Idle customer Firebase Auth user sweep.
 *
 * The customer app signs a diner in with `auth.createCustomToken(uid)`; the
 * client's `signInWithCustomToken` then auto-creates a Firebase Auth user for
 * that uid, and nothing has ever deleted one. Two uid schemes exist:
 * `cust_part_<16-hex device hash>` (current) and `cust_<PIN>_<20-char id>`
 * (legacy, still present in Auth). Both are throwaway session identities — a
 * diner who comes back tomorrow gets a fresh device hash, so an idle one is
 * dead weight, not an account.
 *
 * Census taken 2026-09-13 with `listUsers` over the whole pool:
 *
 *   7,386  auth users total
 *   5,741  `cust_part_*`   (current scheme)
 *   1,587  legacy `cust_*` (no email, no providerData)
 *      46  email users     (staff)
 *      12  phone-number uids (Sharelebrator loyalty accounts, uid IS the phone)
 *
 * Only 146 of the `cust_part_*` users had any activity in the last 48h, so the
 * steady-state population this leaves behind is a few hundred, not thousands.
 *
 * SAFETY RAIL — why the prefix plus the no-provider check is the whole story.
 * The two populations that must never be deleted are excluded *structurally*,
 * not by a list someone has to maintain:
 *
 *   - Staff sign in with email/password, so every staff record has `email` set
 *     and a `password` entry in `providerData`. Both checks reject them, and
 *     their uids are Firebase-generated 28-char ids that do not match the
 *     `cust_` prefix either. Three independent reasons to skip.
 *   - Sharelebrator loyalty accounts use the phone number as the uid, so they
 *     have `phoneNumber` set, a `phone` provider entry, and a uid of digits.
 *     Again three.
 *
 * A candidate therefore has to be a `cust_`-prefixed uid with no email, no
 * phone number and an empty `providerData` — which is exactly what a
 * custom-token-only identity looks like and nothing else in this project does.
 * If a future feature ever gives customer users a real provider, they stop
 * being candidates automatically rather than silently becoming collateral.
 *
 * Rate limit: Firebase's batch `deleteUsers()` takes at most 1,000 uids and is
 * throttled to 1 QPS, hence the chunk size and the ~1.1s pause between chunks.
 * A chunk that fails outright is logged and skipped — an unattended nightly
 * sweep must never abort the run (or the request) over one bad batch.
 *
 * Backup: an armed caller passes `backup`, which is awaited once with every
 * candidate record BEFORE the first delete chunk. A backup that throws aborts
 * the run with `deleted: 0` and `aborted: "backup_failed"` — the one failure
 * mode where continuing is worse than stopping, because Firebase Auth has no
 * undelete and the records would be gone with nothing written down.
 *
 * Deliberately free of `server-only` and of `@/` path aliases: both the cron
 * route and `scripts/purge-customer-auth-users.ts` import this, and the script
 * runs under tsx outside Next's module resolution.
 */

const HOUR_MS = 3_600_000;

/** Firebase caps batch deletes at 1,000 uids per call. */
const DELETE_CHUNK = 1000;

/** `deleteUsers()` is rate limited to 1 QPS; 1.1s leaves headroom for clock skew. */
const CHUNK_PAUSE_MS = 1100;

/** Largest page `listUsers` will return. */
const LIST_PAGE = 1000;

/** Hours of inactivity after which a customer auth identity is disposable. */
export const DEFAULT_MAX_IDLE_HOURS = 48;

/**
 * Both uid schemes, and nothing else. `cust_part_<hash>` is matched by the
 * optional `part_` group; the legacy `cust_<PIN>_<id>` falls through to the
 * general tail.
 */
const CUSTOMER_UID_RE = /^cust_(part_)?[A-Za-z0-9_-]+$/;

/**
 * What gets backed up for one doomed user. Deliberately the whole of what Auth
 * still knows about a custom-token identity — there is no email, phone or
 * provider to record, so the uid plus the three timestamps IS the record. A
 * deleted uid can be recreated from this; a bare uid list could not tell you
 * afterwards whether a given deletion was correct.
 */
export type PurgeCandidate = {
  uid: string;
  creationTime: string | null;
  lastSignInTime: string | null;
  lastRefreshTime: string | null;
};

export type PurgeCustomerAuthUsersResult = {
  /** Auth users walked, across every page. */
  scanned: number;
  /** Of those, users matching the customer-identity shape (prefix + no provider). */
  customerUsers: number;
  /** Customer users also past the idle cutoff. */
  candidates: number;
  /** Users actually deleted — always 0 when write is false. */
  deleted: number;
  /** Deletions Firebase rejected for a reason other than "already gone". */
  failures: number;
  maxIdleHours: number;
  cutoffMs: number;
  /**
   * True only when a `backup` fn ran to completion. False when none was
   * supplied, when the run was report-only, when there was nothing to back up,
   * and when the backup threw (see `aborted`).
   */
  backedUp: boolean;
  /**
   * Set only when the run stopped before deleting anything. The single current
   * cause is a backup that threw: an armed run must never delete records it
   * failed to write down first.
   */
  aborted?: "backup_failed";
};

export type PurgeCustomerAuthUsersOpts = {
  nowMs: number;
  write: boolean;
  maxIdleHours?: number;
  /** Injected in tests so the 1 QPS pause does not make the suite crawl. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Persist the doomed records somewhere durable before a single one is
   * deleted. Awaited once, before the first `deleteUsers` chunk, and only on
   * an armed run with at least one candidate. If it throws, the sweep deletes
   * nothing at all — a failed backup is a reason to stop, not a warning to log
   * on the way past.
   */
  backup?: (records: PurgeCandidate[]) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * True when the uid, email, phone and providerData all say "custom-token-only
 * customer identity". Exported so the script and any future audit can reuse
 * the exact predicate the sweep deletes on rather than re-deriving it.
 */
export function isCustomerAuthUser(user: Pick<UserRecord, "uid" | "email" | "phoneNumber" | "providerData">): boolean {
  if (!CUSTOMER_UID_RE.test(user.uid)) return false;
  if (user.email) return false;
  if (user.phoneNumber) return false;
  if ((user.providerData ?? []).length > 0) return false;
  return true;
}

/**
 * Most recent sign-in evidence, newest source first. Returns NaN when nothing
 * parses — such a user is never a candidate, because "we cannot tell how old
 * this is" must not read as "this is old".
 */
export function lastActivityMs(user: Pick<UserRecord, "metadata">): number {
  const m: any = user.metadata ?? {};
  return Date.parse(m.lastRefreshTime || m.lastSignInTime || m.creationTime);
}

/** The backup record for a user the sweep is about to delete. */
function toCandidate(user: Pick<UserRecord, "uid" | "metadata">): PurgeCandidate {
  const m: any = user.metadata ?? {};
  return {
    uid: user.uid,
    creationTime: m.creationTime ?? null,
    lastSignInTime: m.lastSignInTime ?? null,
    lastRefreshTime: m.lastRefreshTime ?? null,
  };
}

export async function purgeCustomerAuthUsers(
  auth: Auth,
  opts: PurgeCustomerAuthUsersOpts,
): Promise<PurgeCustomerAuthUsersResult> {
  const maxIdleHours = opts.maxIdleHours ?? DEFAULT_MAX_IDLE_HOURS;
  const cutoffMs = opts.nowMs - maxIdleHours * HOUR_MS;
  const sleep = opts.sleep ?? defaultSleep;

  let scanned = 0;
  let customerUsers = 0;
  const candidateRecords: PurgeCandidate[] = [];

  let pageToken: string | undefined = undefined;
  do {
    const page = await auth.listUsers(LIST_PAGE, pageToken);
    for (const user of page.users) {
      scanned++;
      if (!isCustomerAuthUser(user)) continue;
      customerUsers++;
      const activeAt = lastActivityMs(user);
      if (!Number.isFinite(activeAt)) continue;
      if (activeAt < cutoffMs) candidateRecords.push(toCandidate(user));
    }
    pageToken = page.pageToken;
  } while (pageToken);

  const candidates = candidateRecords.length;

  if (!opts.write) {
    return {
      scanned,
      customerUsers,
      candidates,
      deleted: 0,
      failures: 0,
      maxIdleHours,
      cutoffMs,
      backedUp: false,
    };
  }

  // Write the records down before touching a single one of them. Unlike a
  // failed delete chunk — which the loop below deliberately survives — a
  // failed backup invalidates the whole run: every subsequent deletion would
  // be unrecoverable. So this one failure stops everything.
  let backedUp = false;
  if (opts.backup && candidateRecords.length > 0) {
    try {
      await opts.backup(candidateRecords);
      backedUp = true;
    } catch (err) {
      console.error(
        `[purge-customer-auth-users] backup of ${candidateRecords.length} record(s) failed — deleting nothing:`,
        err,
      );
      return {
        scanned,
        customerUsers,
        candidates,
        deleted: 0,
        failures: 0,
        maxIdleHours,
        cutoffMs,
        backedUp: false,
        aborted: "backup_failed",
      };
    }
  }

  let deleted = 0;
  let failures = 0;

  for (let i = 0; i < candidateRecords.length; i += DELETE_CHUNK) {
    if (i > 0) await sleep(CHUNK_PAUSE_MS);
    const chunk = candidateRecords.slice(i, i + DELETE_CHUNK).map((r) => r.uid);
    try {
      const result = await auth.deleteUsers(chunk);
      // A uid that no longer exists is the outcome we wanted, not a failure.
      const alreadyGone = (result.errors ?? []).filter((e: any) =>
        String(e?.error?.code ?? "").includes("user-not-found"),
      ).length;
      deleted += result.successCount + alreadyGone;
      failures += Math.max(0, result.failureCount - alreadyGone);
      if (result.failureCount > alreadyGone) {
        console.warn(
          `[purge-customer-auth-users] chunk ${i / DELETE_CHUNK}: ${result.failureCount - alreadyGone} deletion(s) failed`,
          (result.errors ?? []).slice(0, 3),
        );
      }
    } catch (err) {
      // Never abort the sweep over one chunk: the remaining chunks are
      // independent, and the cron caller would otherwise see a 500 for a
      // run that mostly succeeded.
      console.error(`[purge-customer-auth-users] chunk ${i / DELETE_CHUNK} threw, continuing:`, err);
      failures += chunk.length;
    }
  }

  return { scanned, customerUsers, candidates, deleted, failures, maxIdleHours, cutoffMs, backedUp };
}
