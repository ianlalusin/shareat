import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { isCashierLinked } from "@/lib/loyalty/session-link";

/**
 * Store scoping for Sharelebrator customer records.
 *
 * Customers dine anywhere, so their records are not partitioned by store.
 * What is scoped is *visibility*: a store-scoped staffer may only see the
 * customers that store is actually serving. A record is in scope when the
 * customer is either linked to an open session here, or produced a loyalty
 * event here inside the presence window.
 *
 * The window deliberately outlives the session so a manager can still pull up
 * points or reset a passcode for someone who just walked out.
 *
 * Customers who fall out of the window entirely (last visit days ago) are not
 * reachable by store staff at all — an admin handles those, since admins are
 * global by design. See
 * docs/superpowers/specs/2026-08-20-pins-customer-store-scoping-design.md.
 */
export const PRESENCE_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Whether a logged event puts its customer in scope at the store it names.
 *
 * `login_failed` counts, but only from inside a session (`source:
 * "in_session"`, which the customer app can only produce while holding a
 * verified session token for an open session at that store).
 *
 * That is the forgot-password path, and without it the feature cannot work: a
 * customer who cannot log in never links to the session and never earns
 * points, so nothing else would ever put them in scope, and the customer app's
 * "ask our manager to reset it" prompt would send them to someone whose lookup
 * returns "not active at this store".
 *
 * An earlier version of this file excluded `login_failed` outright, reasoning
 * that it would let anyone make an arbitrary phone number visible by typing it
 * and failing the password. That over-weighted the risk: the person typing
 * never sees the record — only staff do, in /pins — so a customer entering
 * numbers gains nothing. The residual vector is a staff member opening a
 * customer session at their own store to surface a number they already have,
 * which yields a name and a points balance and is audit-logged as an
 * in-session login_failed carrying that store and session id.
 *
 * A standalone (non-session) failed login still grants nothing, and carries no
 * storeId to match on in any case.
 *
 * `password_reset` never counts: it carries no storeId, and granting presence
 * off a staff action would make the guard self-satisfying.
 */
function grantsPresence(entry: DailyEntry): boolean {
  switch (String(entry?.type ?? "")) {
    case "login":
    case "account_created":
    case "points_earned":
      return true;
    case "login_failed":
      return String(entry?.source ?? "") === "in_session";
    default:
      return false;
  }
}

export type PresenceKind = "active" | "recent";

export type StorePresence = {
  phone: string;
  /** `active` = linked to an open session right now. `recent` = inside the window. */
  presence: PresenceKind;
  lastActiveAtMs: number;
  /** What put them in scope: "in_session" | login | account_created | points_earned */
  reason: string;
  sessionId: string | null;
};

type DailyEntry = {
  type?: string;
  phone?: string;
  source?: string | null;
  storeId?: string | null;
  sessionId?: string | null;
  createdAtMs?: number;
};

/** Manila day id (`YYYYMMDD`) — matches the ids written by loyaltyLog.ts. */
export function manilaDayId(atMs: number): string {
  const manila = new Date(new Date(atMs).toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const y = manila.getFullYear();
  const m = String(manila.getMonth() + 1).padStart(2, "0");
  const d = String(manila.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Entries inside the window, newest-part-first.
 *
 * Reads `loyaltyLogsDaily` projections rather than querying `loyaltyLogs` with
 * a `storeId + createdAt` composite index. That is not a micro-optimisation:
 * firestore.indexes.json declares far fewer indexes than the project actually
 * has live, so introducing a required index here would invite a
 * `firebase deploy --only firestore:indexes` that deletes the undeclared ones.
 * Projections keep this to a handful of doc reads and no index at all.
 *
 * Entries are appended in chronological order within a part and parts rotate
 * in order, so we walk parts backwards and stop at the first one whose oldest
 * entry predates the cutoff.
 */
async function readEntriesSince(cutoffMs: number, nowMs: number): Promise<DailyEntry[]> {
  const db = getAdminDb();

  // The window can straddle Manila midnight, in which case yesterday's
  // projection holds part of it. Only read the days the window touches.
  const dayIds = Array.from(new Set([manilaDayId(cutoffMs), manilaDayId(nowMs)]));

  const collected: DailyEntry[] = [];

  for (const dayId of dayIds) {
    const metaSnap = await db.doc(`loyaltyLogsDaily/${dayId}_meta`).get();
    const activePart = metaSnap.exists ? Number(metaSnap.data()?.activePart ?? 0) : 0;

    for (let part = activePart; part >= 0; part--) {
      const partSnap = await db.doc(`loyaltyLogsDaily/${dayId}_${part}`).get();
      if (!partSnap.exists) continue;

      const entries: DailyEntry[] = Array.isArray(partSnap.data()?.entries)
        ? partSnap.data()!.entries
        : [];
      if (entries.length === 0) continue;

      for (const entry of entries) {
        if (Number(entry?.createdAtMs ?? 0) >= cutoffMs) collected.push(entry);
      }

      // If this part's oldest entry is still inside the window, the previous
      // part may be too. Otherwise we have walked past the cutoff — stop.
      if (Number(entries[0]?.createdAtMs ?? 0) < cutoffMs) break;
    }
  }

  return collected;
}

/**
 * Every customer currently in scope at `storeId`, keyed by phone.
 */
export async function resolveStorePresence(
  storeId: string,
  nowMs: number = Date.now()
): Promise<Map<string, StorePresence>> {
  const db = getAdminDb();
  const cutoffMs = nowMs - PRESENCE_WINDOW_MS;
  const byPhone = new Map<string, StorePresence>();

  // 1. Here now — linked to an open session at this store. Read whole, not
  //    queried: one store has at most a few dozen open sessions, and an
  //    inequality query on linkedCustomerPhone would skip docs missing the
  //    field entirely, which is most of them.
  const activeSnap = await db.collection(`stores/${storeId}/activeSessions`).get();
  for (const docSnap of activeSnap.docs) {
    const data = docSnap.data() as any;
    // A cashier link is staff-typed, not customer-proven — it earns points but
    // must not unlock lookup / reset-password / the customer list.
    if (isCashierLinked(data)) continue;
    const phone = String(data?.linkedCustomerPhone ?? "").trim();
    if (!phone) continue;
    byPhone.set(phone, {
      phone,
      presence: "active",
      lastActiveAtMs: nowMs,
      reason: "in_session",
      sessionId: docSnap.id,
    });
  }

  // 2. Recent — a loyalty event at this store inside the window.
  const entries = await readEntriesSince(cutoffMs, nowMs);
  for (const entry of entries) {
    const phone = String(entry?.phone ?? "").trim();
    if (!phone) continue;
    if (String(entry?.storeId ?? "") !== storeId) continue;
    if (!grantsPresence(entry)) continue;

    const atMs = Number(entry?.createdAtMs ?? 0);
    const existing = byPhone.get(phone);
    // An open session always wins: it is the stronger claim, and its
    // lastActiveAtMs is "now" rather than whenever the last event fired.
    if (existing?.presence === "active") continue;
    if (existing && existing.lastActiveAtMs >= atMs) continue;

    byPhone.set(phone, {
      phone,
      presence: "recent",
      lastActiveAtMs: atMs,
      reason: String(entry?.type ?? "recent"),
      sessionId: entry?.sessionId ? String(entry.sessionId) : null,
    });
  }

  return byPhone;
}

/**
 * Whether one customer is visible to staff at `storeId`.
 *
 * Returns the presence record when in scope so callers can show *why*, and
 * null when the customer exists but belongs to another branch's window.
 */
export async function resolvePhonePresence(
  storeId: string,
  phone: string,
  nowMs: number = Date.now()
): Promise<StorePresence | null> {
  const presence = await resolveStorePresence(storeId, nowMs);
  return presence.get(phone) ?? null;
}
