import { describe, it, expect, vi } from "vitest";
import {
  purgeCustomerAuthUsers,
  DEFAULT_MAX_IDLE_HOURS,
  type PurgeCandidate,
} from "@/lib/server/retention/purge-customer-auth-users";

/**
 * This sweep deletes real Firebase Auth users on an unattended nightly
 * schedule, and the only thing separating a diner's throwaway identity from a
 * staff login or a Sharelebrator loyalty account is the candidate predicate.
 * So the predicate, the cutoff boundary, the report-only mode and the 1 QPS
 * chunking each get their own test.
 */

const HOUR_MS = 3_600_000;
const NOW = Date.parse("2026-09-13T04:00:00.000Z");

type FakeUser = {
  uid: string;
  email?: string;
  phoneNumber?: string;
  providerData?: unknown[];
  metadata: { creationTime?: string; lastSignInTime?: string; lastRefreshTime?: string | null };
};

/** A customer identity idle for `idleHours`, shaped like the real thing. */
function customer(uid: string, idleHours: number): FakeUser {
  return {
    uid,
    providerData: [],
    metadata: { lastRefreshTime: new Date(NOW - idleHours * HOUR_MS).toISOString() },
  };
}

type DeleteOutcome = {
  successCount: number;
  failureCount: number;
  errors: Array<{ index: number; error: { code: string; message?: string } }>;
};

/**
 * Minimal fake covering only what the sweep calls: paged `listUsers` and
 * batch `deleteUsers`. `pageSize` forces multi-page paging with few users.
 */
function makeFakeAuth(
  users: FakeUser[],
  opts: { pageSize?: number; onDelete?: (uids: string[], call: number) => DeleteOutcome } = {},
) {
  const pageSize = opts.pageSize ?? 1000;
  const deleteCalls: string[][] = [];
  const listPages: number[] = [];

  const auth = {
    listUsers: async (max: number, pageToken?: string) => {
      listPages.push(max);
      const start = pageToken ? Number(pageToken) : 0;
      const slice = users.slice(start, start + Math.min(max, pageSize));
      const next = start + slice.length;
      return { users: slice, pageToken: next < users.length ? String(next) : undefined };
    },
    deleteUsers: async (uids: string[]): Promise<DeleteOutcome> => {
      const call = deleteCalls.length;
      deleteCalls.push(uids);
      if (opts.onDelete) return opts.onDelete(uids, call);
      return { successCount: uids.length, failureCount: 0, errors: [] };
    },
  };

  return { auth: auth as any, deleteCalls, listPages };
}

function makeSleep() {
  const slept: number[] = [];
  return { slept, sleep: async (ms: number) => void slept.push(ms) };
}

describe("purgeCustomerAuthUsers - candidate predicate", () => {
  it("keeps staff, loyalty and non-customer uids; takes only custom-token customer identities", async () => {
    const users: FakeUser[] = [
      // Deletable: both uid schemes, no email, no phone, no providers.
      customer("cust_part_a1b2c3d4e5f60718", 100),
      customer("cust_482915_Qx7kLm2ZpR9vTn4bWc0y", 100),

      // Staff: email + a password provider, and a Firebase-generated uid.
      {
        uid: "9xKQ2mVb1cP0aZtR7yLu3EdWfGh2",
        email: "manager@shareat.net",
        providerData: [{ providerId: "password" }],
        metadata: { lastRefreshTime: new Date(NOW - 100 * HOUR_MS).toISOString() },
      },
      // Sharelebrator loyalty: the phone number IS the uid.
      {
        uid: "+639171234567",
        phoneNumber: "+639171234567",
        providerData: [{ providerId: "phone" }],
        metadata: { lastRefreshTime: new Date(NOW - 100 * HOUR_MS).toISOString() },
      },
      // cust_-prefixed uids that acquired an identity - all excluded.
      { ...customer("cust_part_ffffffffffffffff", 100), email: "diner@example.com" },
      { ...customer("cust_part_eeeeeeeeeeeeeeee", 100), phoneNumber: "+639170000000" },
      { ...customer("cust_part_dddddddddddddddd", 100), providerData: [{ providerId: "google.com" }] },

      // Prefix near-misses.
      customer("custom_report_runner", 100),
      customer("service-account", 100),
      customer("cust", 100),
      customer("cust_", 100),
    ];

    const { auth, deleteCalls } = makeFakeAuth(users);
    const sleeper = makeSleep();
    const r = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: true, sleep: sleeper.sleep });

    expect(r.scanned).toBe(users.length);
    expect(r.customerUsers).toBe(2);
    expect(r.candidates).toBe(2);
    expect(deleteCalls).toEqual([
      ["cust_part_a1b2c3d4e5f60718", "cust_482915_Qx7kLm2ZpR9vTn4bWc0y"],
    ]);
    expect(r.deleted).toBe(2);
    expect(r.failures).toBe(0);
  });

  it("walks every page of the user pool", async () => {
    const users = Array.from({ length: 25 }, (_, i) =>
      customer(`cust_part_${String(i).padStart(16, "0")}`, 100),
    );
    const { auth, listPages } = makeFakeAuth(users, { pageSize: 10 });
    const r = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: false });

    expect(listPages.length).toBe(3); // 10 + 10 + 5
    expect(listPages.every((max) => max === 1000)).toBe(true);
    expect(r.scanned).toBe(25);
    expect(r.candidates).toBe(25);
  });

  it("never treats an unparseable timestamp as old", async () => {
    const users: FakeUser[] = [
      { uid: "cust_part_0000000000000001", providerData: [], metadata: {} },
      { uid: "cust_part_0000000000000002", providerData: [], metadata: { lastRefreshTime: "not a date" } },
    ];
    const { auth, deleteCalls } = makeFakeAuth(users);
    const r = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: true, sleep: makeSleep().sleep });

    expect(r.customerUsers).toBe(2);
    expect(r.candidates).toBe(0);
    expect(deleteCalls).toEqual([]);
  });

  it("falls back through lastRefreshTime, lastSignInTime, then creationTime", async () => {
    const stale = new Date(NOW - 100 * HOUR_MS).toISOString();
    const fresh = new Date(NOW - 1 * HOUR_MS).toISOString();
    const users: FakeUser[] = [
      // Fresh refresh wins over a stale creation.
      { uid: "cust_part_000000000000000a", providerData: [], metadata: { creationTime: stale, lastRefreshTime: fresh } },
      // No refresh: sign-in is used.
      { uid: "cust_part_000000000000000b", providerData: [], metadata: { creationTime: stale, lastSignInTime: fresh } },
      // Never came back: creation time is all there is, and it is stale.
      { uid: "cust_part_000000000000000c", providerData: [], metadata: { creationTime: stale, lastRefreshTime: null } },
    ];
    const { auth } = makeFakeAuth(users);
    const r = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: false });

    expect(r.candidates).toBe(1);
  });
});

describe("purgeCustomerAuthUsers - idle cutoff", () => {
  it("defaults to 48 hours and reports the cutoff it used", async () => {
    expect(DEFAULT_MAX_IDLE_HOURS).toBe(48);
    const { auth } = makeFakeAuth([]);
    const r = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: false });
    expect(r.maxIdleHours).toBe(48);
    expect(r.cutoffMs).toBe(NOW - 48 * HOUR_MS);
  });

  it("keeps a user idle exactly 48h and takes one a millisecond past it", async () => {
    const cutoff = NOW - 48 * HOUR_MS;
    const users: FakeUser[] = [
      { uid: "cust_part_exactly48h00000", providerData: [], metadata: { lastRefreshTime: new Date(cutoff).toISOString() } },
      { uid: "cust_part_justover48h000", providerData: [], metadata: { lastRefreshTime: new Date(cutoff - 1).toISOString() } },
      { uid: "cust_part_justunder48h00", providerData: [], metadata: { lastRefreshTime: new Date(cutoff + 1).toISOString() } },
    ];
    const { auth, deleteCalls } = makeFakeAuth(users);
    const r = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: true, sleep: makeSleep().sleep });

    expect(r.candidates).toBe(1);
    expect(deleteCalls).toEqual([["cust_part_justover48h000"]]);
  });

  it("honours a maxIdleHours override", async () => {
    const users = [customer("cust_part_idle10h00000000", 10), customer("cust_part_idle30h00000000", 30)];
    const { auth } = makeFakeAuth(users);

    const wide = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: false, maxIdleHours: 48 });
    expect(wide.candidates).toBe(0);

    const narrow = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: false, maxIdleHours: 24 });
    expect(narrow.candidates).toBe(1);
    expect(narrow.maxIdleHours).toBe(24);
    expect(narrow.cutoffMs).toBe(NOW - 24 * HOUR_MS);
  });
});

describe("purgeCustomerAuthUsers - report-only mode", () => {
  it("counts candidates but deletes nothing and never calls deleteUsers", async () => {
    const users = Array.from({ length: 7 }, (_, i) =>
      customer(`cust_part_${String(i).padStart(16, "0")}`, 100),
    );
    const { auth, deleteCalls } = makeFakeAuth(users);
    const sleeper = makeSleep();
    const r = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: false, sleep: sleeper.sleep });

    expect(r.candidates).toBe(7);
    expect(r.deleted).toBe(0);
    expect(r.failures).toBe(0);
    expect(deleteCalls).toEqual([]);
    expect(sleeper.slept).toEqual([]);
  });
});

describe("purgeCustomerAuthUsers - batching and failures", () => {
  it("chunks at 1000 and pauses between chunks for the 1 QPS limit", async () => {
    const users = Array.from({ length: 2500 }, (_, i) =>
      customer(`cust_part_${String(i).padStart(16, "0")}`, 100),
    );
    const { auth, deleteCalls } = makeFakeAuth(users, { pageSize: 1000 });
    const sleeper = makeSleep();
    const r = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: true, sleep: sleeper.sleep });

    expect(r.candidates).toBe(2500);
    expect(deleteCalls.map((c) => c.length)).toEqual([1000, 1000, 500]);
    // No pause before the first chunk, one between each pair after that.
    expect(sleeper.slept.length).toBe(2);
    expect(sleeper.slept.every((ms) => ms >= 1100)).toBe(true);
    expect(r.deleted).toBe(2500);
    expect(r.failures).toBe(0);
  });

  it("counts real rejections as failures but treats already-gone uids as deleted", async () => {
    const users = Array.from({ length: 1200 }, (_, i) =>
      customer(`cust_part_${String(i).padStart(16, "0")}`, 100),
    );
    const { auth } = makeFakeAuth(users, {
      pageSize: 1000,
      onDelete: (uids, call) => {
        if (call !== 1) return { successCount: uids.length, failureCount: 0, errors: [] };
        return {
          successCount: uids.length - 3,
          failureCount: 3,
          errors: [
            { index: 0, error: { code: "auth/user-not-found" } },
            { index: 1, error: { code: "auth/user-not-found" } },
            { index: 2, error: { code: "auth/internal-error" } },
          ],
        };
      },
    });
    const r = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: true, sleep: makeSleep().sleep });

    expect(r.candidates).toBe(1200);
    // 1000 clean + (197 clean + 2 already-gone) = 1199 gone, 1 genuine failure.
    expect(r.deleted).toBe(1199);
    expect(r.failures).toBe(1);
  });

  it("does not abort the sweep when a whole chunk throws", async () => {
    const users = Array.from({ length: 2100 }, (_, i) =>
      customer(`cust_part_${String(i).padStart(16, "0")}`, 100),
    );
    const { auth, deleteCalls } = makeFakeAuth(users, {
      pageSize: 1000,
      onDelete: (uids, call) => {
        if (call === 0) throw new Error("QUOTA_EXCEEDED");
        return { successCount: uids.length, failureCount: 0, errors: [] };
      },
    });
    const r = await purgeCustomerAuthUsers(auth, { nowMs: NOW, write: true, sleep: makeSleep().sleep });

    // All three chunks were attempted even though the first blew up.
    expect(deleteCalls.map((c) => c.length)).toEqual([1000, 1000, 100]);
    expect(r.failures).toBe(1000);
    expect(r.deleted).toBe(1100);
  });
});

/**
 * Firebase Auth has no undelete. The backup is therefore the only thing that
 * makes an armed run reversible, which is why a backup that throws has to stop
 * the sweep dead — the opposite of the "one bad chunk never aborts the run"
 * rule above, and the distinction worth pinning down in tests.
 */
describe("purgeCustomerAuthUsers - backup before delete", () => {
  it("hands the backup every candidate record before the first deleteUsers call", async () => {
    const users: FakeUser[] = [
      {
        uid: "cust_part_0000000000000001",
        providerData: [],
        metadata: {
          creationTime: new Date(NOW - 300 * HOUR_MS).toISOString(),
          lastSignInTime: new Date(NOW - 200 * HOUR_MS).toISOString(),
          lastRefreshTime: new Date(NOW - 100 * HOUR_MS).toISOString(),
        },
      },
      // Only a creation time: the other two fields must come back as null, not
      // undefined — a Firestore write rejects undefined.
      {
        uid: "cust_part_0000000000000002",
        providerData: [],
        metadata: { creationTime: new Date(NOW - 300 * HOUR_MS).toISOString() },
      },
      // Fresh: never reaches the backup.
      customer("cust_part_0000000000000003", 1),
    ];

    const { auth, deleteCalls } = makeFakeAuth(users);
    let deleteCallsAtBackupTime = -1;
    const seen: PurgeCandidate[][] = [];
    const backup = vi.fn(async (records: PurgeCandidate[]) => {
      deleteCallsAtBackupTime = deleteCalls.length;
      seen.push(records);
    });

    const r = await purgeCustomerAuthUsers(auth, {
      nowMs: NOW,
      write: true,
      sleep: makeSleep().sleep,
      backup,
    });

    expect(backup).toHaveBeenCalledTimes(1);
    // The whole point: nothing had been deleted yet when the backup ran.
    expect(deleteCallsAtBackupTime).toBe(0);
    expect(seen[0]).toEqual([
      {
        uid: "cust_part_0000000000000001",
        creationTime: new Date(NOW - 300 * HOUR_MS).toISOString(),
        lastSignInTime: new Date(NOW - 200 * HOUR_MS).toISOString(),
        lastRefreshTime: new Date(NOW - 100 * HOUR_MS).toISOString(),
      },
      {
        uid: "cust_part_0000000000000002",
        creationTime: new Date(NOW - 300 * HOUR_MS).toISOString(),
        lastSignInTime: null,
        lastRefreshTime: null,
      },
    ]);
    // ...and the deletion still happened, on exactly the backed-up uids.
    expect(deleteCalls).toEqual([
      ["cust_part_0000000000000001", "cust_part_0000000000000002"],
    ]);
    expect(r.backedUp).toBe(true);
    expect(r.aborted).toBeUndefined();
    expect(r.deleted).toBe(2);
  });

  it("backs up once for a multi-chunk run, before any chunk goes out", async () => {
    const users = Array.from({ length: 2500 }, (_, i) =>
      customer(`cust_part_${String(i).padStart(16, "0")}`, 100),
    );
    const { auth, deleteCalls } = makeFakeAuth(users, { pageSize: 1000 });
    let deleteCallsAtBackupTime = -1;
    let backedUpCount = -1;
    const r = await purgeCustomerAuthUsers(auth, {
      nowMs: NOW,
      write: true,
      sleep: makeSleep().sleep,
      backup: async (records) => {
        deleteCallsAtBackupTime = deleteCalls.length;
        backedUpCount = records.length;
      },
    });

    expect(deleteCallsAtBackupTime).toBe(0);
    expect(backedUpCount).toBe(2500);
    expect(deleteCalls.map((c) => c.length)).toEqual([1000, 1000, 500]);
    expect(r.backedUp).toBe(true);
    expect(r.deleted).toBe(2500);
  });

  it("deletes nothing at all when the backup throws", async () => {
    const users = Array.from({ length: 2500 }, (_, i) =>
      customer(`cust_part_${String(i).padStart(16, "0")}`, 100),
    );
    const { auth, deleteCalls } = makeFakeAuth(users, { pageSize: 1000 });
    const sleeper = makeSleep();
    const r = await purgeCustomerAuthUsers(auth, {
      nowMs: NOW,
      write: true,
      sleep: sleeper.sleep,
      backup: async () => {
        throw new Error("PERMISSION_DENIED writing system/authUserPurgeRuns");
      },
    });

    expect(deleteCalls).toEqual([]);
    expect(sleeper.slept).toEqual([]);
    expect(r.aborted).toBe("backup_failed");
    expect(r.backedUp).toBe(false);
    expect(r.deleted).toBe(0);
    expect(r.failures).toBe(0);
    // The scan still happened and is still reported, so the log line says how
    // many records were at risk.
    expect(r.candidates).toBe(2500);
    expect(r.scanned).toBe(2500);
  });

  it("proceeds with the deletion when no backup fn is given, reporting backedUp: false", async () => {
    const users = Array.from({ length: 5 }, (_, i) =>
      customer(`cust_part_${String(i).padStart(16, "0")}`, 100),
    );
    const { auth, deleteCalls } = makeFakeAuth(users);
    const r = await purgeCustomerAuthUsers(auth, {
      nowMs: NOW,
      write: true,
      sleep: makeSleep().sleep,
    });

    expect(r.backedUp).toBe(false);
    expect(r.aborted).toBeUndefined();
    expect(deleteCalls.map((c) => c.length)).toEqual([5]);
    expect(r.deleted).toBe(5);
  });

  it("reports backedUp: false when there is nothing to back up", async () => {
    const { auth, deleteCalls } = makeFakeAuth([customer("cust_part_0000000000000001", 1)]);
    const backup = vi.fn(async () => {});
    const r = await purgeCustomerAuthUsers(auth, {
      nowMs: NOW,
      write: true,
      sleep: makeSleep().sleep,
      backup,
    });

    expect(r.candidates).toBe(0);
    expect(backup).not.toHaveBeenCalled();
    expect(deleteCalls).toEqual([]);
    expect(r.backedUp).toBe(false);
  });

  it("never calls the backup on a report-only run", async () => {
    const users = Array.from({ length: 7 }, (_, i) =>
      customer(`cust_part_${String(i).padStart(16, "0")}`, 100),
    );
    const { auth, deleteCalls } = makeFakeAuth(users);
    const backup = vi.fn(async () => {});
    const r = await purgeCustomerAuthUsers(auth, {
      nowMs: NOW,
      write: false,
      sleep: makeSleep().sleep,
      backup,
    });

    expect(r.candidates).toBe(7);
    expect(backup).not.toHaveBeenCalled();
    expect(deleteCalls).toEqual([]);
    expect(r.backedUp).toBe(false);
    expect(r.aborted).toBeUndefined();
  });
});
