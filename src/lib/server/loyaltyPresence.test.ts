import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the /pins customer store-scoping guard.
 *
 * The load-bearing cases are the *denials*. A false positive here is a privacy
 * leak that nothing downstream catches — the UI renders whatever the resolver
 * returns — so "another store's event does not grant presence" and
 * "login_failed does not grant presence" matter more than the happy path.
 *
 * Times are built as explicit UTC instants and converted by hand, because the
 * resolver derives Manila day ids for the projection lookup. Under a UTC-ish
 * CI clock a naive implementation still passes the happy path and only breaks
 * for real customers between 00:00 and 08:00 Manila.
 */

const STORE = "storeA";
const OTHER_STORE = "storeB";
const PHONE = "09171234567";

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => harness.db,
}));

import {
  PRESENCE_WINDOW_MS,
  manilaDayId,
  resolveStorePresence,
  resolvePhonePresence,
} from "./loyaltyPresence";

// --- in-memory firestore double --------------------------------------------

const harness: { db: any; docs: Record<string, any>; cols: Record<string, Record<string, any>> } = {
  db: null,
  docs: {},
  cols: {},
};

beforeEach(() => {
  harness.docs = {};
  harness.cols = {};
  harness.db = {
    doc: (path: string) => ({
      get: async () => ({
        exists: harness.docs[path] !== undefined,
        data: () => harness.docs[path],
      }),
    }),
    collection: (path: string) => ({
      get: async () => ({
        docs: Object.entries(harness.cols[path] ?? {}).map(([id, data]) => ({
          id,
          data: () => data,
        })),
      }),
    }),
  };
});

/** Manila wall-clock -> epoch ms. Manila is UTC+8 year-round, no DST. */
function manila(y: number, m: number, d: number, hh: number, mm = 0): number {
  return Date.UTC(y, m - 1, d, hh - 8, mm);
}

function seedActiveSession(storeId: string, sessionId: string, phone: string | null) {
  harness.cols[`stores/${storeId}/activeSessions`] ??= {};
  harness.cols[`stores/${storeId}/activeSessions`][sessionId] = {
    tableId: "t1",
    ...(phone ? { linkedCustomerPhone: phone } : {}),
  };
}

function seedCashierLinkedSession(storeId: string, sessionId: string, phone: string) {
  harness.cols[`stores/${storeId}/activeSessions`] ??= {};
  harness.cols[`stores/${storeId}/activeSessions`][sessionId] = {
    tableId: "t1",
    linkedCustomerPhone: phone,
    linkedBy: "cashier",
    linkedByUid: "staff1",
  };
}

function seedProjection(dayId: string, entries: any[], part = 0) {
  harness.docs[`loyaltyLogsDaily/${dayId}_meta`] = { dayId, activePart: part };
  harness.docs[`loyaltyLogsDaily/${dayId}_${part}`] = {
    dayId,
    partIndex: part,
    entryCount: entries.length,
    entries,
  };
}

function entry(over: Record<string, any> = {}) {
  return {
    logId: "l1",
    type: "login",
    phone: PHONE,
    customerName: "Ana",
    source: "in_session",
    storeId: STORE,
    sessionId: "s1",
    createdAtMs: 0,
    ...over,
  };
}

// --- manilaDayId ------------------------------------------------------------

describe("manilaDayId", () => {
  it("rolls the day at Manila midnight, not UTC midnight", () => {
    // 23:30 Manila on the 19th is still 15:30 UTC on the 19th.
    expect(manilaDayId(manila(2026, 8, 19, 23, 30))).toBe("20260819");
    // 00:30 Manila on the 20th is 16:30 UTC on the *19th* — the case that
    // silently breaks if the id is derived from the UTC date.
    expect(manilaDayId(manila(2026, 8, 20, 0, 30))).toBe("20260820");
  });

  it("pads single-digit months and days", () => {
    expect(manilaDayId(manila(2026, 1, 5, 12))).toBe("20260105");
  });
});

// --- presence ---------------------------------------------------------------

describe("resolveStorePresence", () => {
  const now = manila(2026, 8, 20, 14, 0);
  const today = "20260820";

  it("includes a customer linked to an open session here", async () => {
    seedActiveSession(STORE, "s1", PHONE);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.get(PHONE)).toMatchObject({
      phone: PHONE,
      presence: "active",
      reason: "in_session",
      sessionId: "s1",
    });
  });

  it("does not grant presence for a cashier-linked session", async () => {
    // A staff member typing any phone into the link dialog must not be able to
    // unlock lookup / reset-password / the customer list for that number.
    seedCashierLinkedSession(STORE, "s1", PHONE);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.has(PHONE)).toBe(false);
  });

  it("still grants presence for a customer-linked session next to a cashier-linked one", async () => {
    seedCashierLinkedSession(STORE, "s1", "09990000000");
    seedActiveSession(STORE, "s2", PHONE);
    harness.cols[`stores/${STORE}/activeSessions`]["s2"].linkedBy = "participant";

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.has("09990000000")).toBe(false);
    expect(presence.get(PHONE)).toMatchObject({ presence: "active", sessionId: "s2" });
  });

  it("ignores open sessions with no linked customer", async () => {
    seedActiveSession(STORE, "s1", null);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.size).toBe(0);
  });

  it("includes a customer who logged in here inside the window", async () => {
    seedProjection(today, [entry({ createdAtMs: now - 90 * 60 * 1000 })]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.get(PHONE)).toMatchObject({ presence: "recent", reason: "login" });
  });

  it("keeps a customer visible after their session ended, inside the window", async () => {
    // No active session at all — this is the "walked out 30 minutes ago" case
    // the window exists to serve.
    seedProjection(today, [
      entry({ type: "points_earned", createdAtMs: now - 30 * 60 * 1000 }),
    ]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.get(PHONE)?.presence).toBe("recent");
  });

  it("does not grant presence on a points_earned from a cashier-linked session", async () => {
    // Billout deletes the activeSessions projection, so the earn event is the
    // only trace left; it must not re-open lookup/reset for a typed-in phone.
    seedProjection(today, [
      entry({ type: "points_earned", viaCashierLink: true, createdAtMs: now - 10 * 60 * 1000 }),
    ]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.has(PHONE)).toBe(false);
  });

  it("still grants presence on a normal points_earned (no viaCashierLink)", async () => {
    seedProjection(today, [
      entry({ type: "points_earned", createdAtMs: now - 10 * 60 * 1000 }),
      entry({ logId: "l2", type: "points_earned", viaCashierLink: false, phone: "09990000000", createdAtMs: now - 5 * 60 * 1000 }),
    ]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.get(PHONE)).toMatchObject({ presence: "recent", reason: "points_earned" });
    expect(presence.has("09990000000")).toBe(true);
  });

  it("a cashier-linked earn does not mask a genuine earlier login for the same phone", async () => {
    seedProjection(today, [
      entry({ logId: "a", type: "login", createdAtMs: now - 60 * 60 * 1000 }),
      entry({ logId: "b", type: "points_earned", viaCashierLink: true, createdAtMs: now - 5 * 60 * 1000 }),
    ]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.get(PHONE)).toMatchObject({ reason: "login", lastActiveAtMs: now - 60 * 60 * 1000 });
  });

  it("excludes an event older than the window", async () => {
    seedProjection(today, [
      entry({ createdAtMs: now - PRESENCE_WINDOW_MS - 60 * 1000 }),
    ]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.has(PHONE)).toBe(false);
  });

  it("excludes an event from another store", async () => {
    seedProjection(today, [
      entry({ storeId: OTHER_STORE, createdAtMs: now - 10 * 60 * 1000 }),
    ]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.has(PHONE)).toBe(false);
  });

  it("grants presence on an in-session login_failed", async () => {
    // The forgot-password path. A customer who cannot log in never links to
    // the session and never earns points, so this is the ONLY signal that puts
    // them in scope — and the customer app tells them to ask the manager for a
    // reset, which only works if the manager can see them.
    seedProjection(today, [
      entry({ type: "login_failed", source: "in_session", createdAtMs: now - 5 * 60 * 1000 }),
    ]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.get(PHONE)?.presence).toBe("recent");
  });

  it("does not grant presence on a standalone login_failed", async () => {
    // Outside a session there is no verified session token behind the attempt,
    // so it is just a phone number someone typed at an unknown keyboard.
    seedProjection(today, [
      entry({ type: "login_failed", source: "standalone", createdAtMs: now - 5 * 60 * 1000 }),
    ]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.has(PHONE)).toBe(false);
  });

  it("does not grant presence on a login_failed with no source", async () => {
    // Older projection entries predate the source field; absent must not pass.
    seedProjection(today, [
      entry({ type: "login_failed", source: null, createdAtMs: now - 5 * 60 * 1000 }),
    ]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.has(PHONE)).toBe(false);
  });

  it("does not grant presence on password_reset", async () => {
    // A staff action must not be the thing that authorises the staff action.
    seedProjection(today, [
      entry({ type: "password_reset", createdAtMs: now - 5 * 60 * 1000 }),
    ]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.has(PHONE)).toBe(false);
  });

  it("prefers the open session over an older recent event", async () => {
    seedActiveSession(STORE, "s9", PHONE);
    seedProjection(today, [entry({ createdAtMs: now - 100 * 60 * 1000 })]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.get(PHONE)).toMatchObject({ presence: "active", sessionId: "s9" });
    expect(presence.size).toBe(1);
  });

  it("keeps the most recent event when a customer has several", async () => {
    seedProjection(today, [
      entry({ logId: "a", type: "login", createdAtMs: now - 90 * 60 * 1000 }),
      entry({ logId: "b", type: "points_earned", createdAtMs: now - 20 * 60 * 1000 }),
    ]);

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.get(PHONE)).toMatchObject({
      reason: "points_earned",
      lastActiveAtMs: now - 20 * 60 * 1000,
    });
  });

  it("reads yesterday's projection when the window straddles Manila midnight", async () => {
    const justAfterMidnight = manila(2026, 8, 20, 0, 30);
    // 23:00 on the 19th Manila — inside a 2h window from 00:30 on the 20th,
    // but filed under yesterday's day id.
    seedProjection("20260819", [
      entry({ createdAtMs: manila(2026, 8, 19, 23, 0) }),
    ]);

    const presence = await resolveStorePresence(STORE, justAfterMidnight);

    expect(presence.get(PHONE)?.presence).toBe("recent");
  });

  it("walks back through rotated parts while entries stay inside the window", async () => {
    harness.docs[`loyaltyLogsDaily/${today}_meta`] = { dayId: today, activePart: 1 };
    harness.docs[`loyaltyLogsDaily/${today}_0`] = {
      entries: [entry({ logId: "old", phone: "09990000000", createdAtMs: now - 100 * 60 * 1000 })],
    };
    harness.docs[`loyaltyLogsDaily/${today}_1`] = {
      entries: [entry({ logId: "new", createdAtMs: now - 80 * 60 * 1000 })],
    };

    const presence = await resolveStorePresence(STORE, now);

    expect(presence.has(PHONE)).toBe(true);
    expect(presence.has("09990000000")).toBe(true);
  });

  it("returns nothing when the store has no projection or sessions at all", async () => {
    const presence = await resolveStorePresence(STORE, now);
    expect(presence.size).toBe(0);
  });
});

describe("resolvePhonePresence", () => {
  const now = manila(2026, 8, 20, 14, 0);

  it("returns the record when in scope", async () => {
    seedActiveSession(STORE, "s1", PHONE);
    await expect(resolvePhonePresence(STORE, PHONE, now)).resolves.toMatchObject({
      presence: "active",
    });
  });

  it("returns null for a cashier-linked session", async () => {
    seedCashierLinkedSession(STORE, "s1", PHONE);
    await expect(resolvePhonePresence(STORE, PHONE, now)).resolves.toBeNull();
  });

  it("returns null for a customer who is only active at another store", async () => {
    seedActiveSession(OTHER_STORE, "s1", PHONE);
    await expect(resolvePhonePresence(STORE, PHONE, now)).resolves.toBeNull();
  });

  it("returns null once the window has passed — the admin-escalation case", async () => {
    seedProjection("20260820", [
      entry({ createdAtMs: now - PRESENCE_WINDOW_MS - 1000 }),
    ]);
    await expect(resolvePhonePresence(STORE, PHONE, now)).resolves.toBeNull();
  });
});
