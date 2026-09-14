import { describe, it, expect, vi } from "vitest";

/**
 * Sentinels stand in for the real FieldValue singletons. The fake db below
 * interprets them, so a test can assert on the *effect* of a delete/arrayUnion
 * rather than on the sentinel object being handed to Firestore.
 */
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    delete: () => ({ __sentinel: "delete" }),
    arrayUnion: (...values: unknown[]) => ({ __sentinel: "arrayUnion", values }),
  },
}));

import {
  LEGACY_COLLECTION,
  LegacyLoyaltyError,
  claimLegacyCustomer,
  seedLegacyCustomers,
  summarizeLegacy,
  unclaimLegacyCustomer,
  type LegacyLoyaltyCustomer,
  type LegacyLoyaltySeedRow,
} from "./legacy-loyalty";

// Invented people only. The real claim list holds live customer names and
// never enters the repo.
const SOURCE = "Test Sheet.xlsx / EPOINTS, 3 ledger rows";

function seedRow(over: Partial<LegacyLoyaltySeedRow> = {}): LegacyLoyaltySeedRow {
  return {
    id: "juno-tabora",
    name: "Juno Tabora",
    altNames: [],
    legacyIds: ["aa11bb22"],
    ledgerRows: 4,
    firstVisitMs: 1_656_950_400_000,
    lastVisitMs: 1_690_473_600_000,
    legacyPoints: 22,
    newPoints: 4,
    emails: [],
    warnings: [],
    ...over,
  };
}

function parkedDoc(over: Partial<LegacyLoyaltyCustomer> = {}): LegacyLoyaltyCustomer {
  return {
    ...seedRow(),
    status: "parked",
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    source: SOURCE,
    ...over,
  };
}

/**
 * Minimal Firestore fake covering only what legacy-loyalty.ts calls:
 * db.doc(path).get(), db.batch().set(ref, data, {merge}).commit(),
 * db.runTransaction(fn) with tx.get(ref) / tx.update(ref, data).
 */
function makeFakeDb(initial: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(structuredClone(initial)));
  const batchCommits: number[] = [];
  const sets: Array<{ path: string; data: any }> = [];
  const updates: Array<{ path: string; data: any }> = [];

  function applyUpdate(path: string, data: Record<string, any>) {
    const next = { ...(store.get(path) ?? {}) };
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && (value as any).__sentinel === "delete") {
        delete next[key];
      } else if (value && typeof value === "object" && (value as any).__sentinel === "arrayUnion") {
        next[key] = [...(Array.isArray(next[key]) ? next[key] : []), ...(value as any).values];
      } else {
        next[key] = value;
      }
    }
    store.set(path, next);
  }

  const docRef = (path: string) => ({
    path,
    get: async () => ({
      exists: store.has(path),
      data: () => store.get(path),
    }),
  });

  const db = {
    doc: (path: string) => docRef(path),
    batch: () => {
      const staged: Array<{ path: string; data: any }> = [];
      return {
        set: (ref: { path: string }, data: any, _opts?: { merge?: boolean }) => {
          staged.push({ path: ref.path, data });
        },
        commit: async () => {
          batchCommits.push(staged.length);
          for (const s of staged) {
            sets.push(s);
            applyUpdate(s.path, s.data);
          }
        },
      };
    },
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const staged: Array<{ path: string; data: any }> = [];
      const tx = {
        get: async (ref: { path: string }) => ({
          exists: store.has(ref.path),
          data: () => store.get(ref.path),
        }),
        update: (ref: { path: string }, data: any) => {
          staged.push({ path: ref.path, data });
        },
      };
      // A throw inside the callback must leave the store untouched, exactly
      // like a real aborted transaction.
      const out = await fn(tx);
      for (const s of staged) {
        updates.push(s);
        applyUpdate(s.path, s.data);
      }
      return out;
    },
  };

  return { db: db as any, store, sets, updates, batchCommits };
}

describe("seedLegacyCustomers", () => {
  it("creates a parked doc when none exists, stamping createdAtMs", async () => {
    const { db, store } = makeFakeDb();

    const result = await seedLegacyCustomers(db, [seedRow()], {
      source: SOURCE,
      write: true,
      nowMs: 1_800_000_000_000,
    });

    expect(result).toEqual({ created: 1, updated: 0, skippedClaimed: 0 });
    const doc = store.get(`${LEGACY_COLLECTION}/juno-tabora`);
    expect(doc.status).toBe("parked");
    expect(doc.name).toBe("Juno Tabora");
    expect(doc.newPoints).toBe(4);
    expect(doc.source).toBe(SOURCE);
    expect(doc.createdAtMs).toBe(1_800_000_000_000);
    expect(doc.updatedAtMs).toBe(1_800_000_000_000);
  });

  it("refreshes a still-parked doc without restating createdAtMs", async () => {
    const { db, store } = makeFakeDb({
      [`${LEGACY_COLLECTION}/juno-tabora`]: parkedDoc({ newPoints: 4, warnings: [] }),
    });

    // A corrected export: the conversion was re-run and a warning was added.
    const result = await seedLegacyCustomers(
      db,
      [seedRow({ newPoints: 9, warnings: ["merged from 3 legacy IDs"] })],
      { source: SOURCE, write: true, nowMs: 1_800_000_000_000 },
    );

    expect(result).toEqual({ created: 0, updated: 1, skippedClaimed: 0 });
    const doc = store.get(`${LEGACY_COLLECTION}/juno-tabora`);
    expect(doc.newPoints).toBe(9);
    expect(doc.warnings).toEqual(["merged from 3 legacy IDs"]);
    expect(doc.status).toBe("parked");
    expect(doc.createdAtMs).toBe(1_700_000_000_000);
    expect(doc.updatedAtMs).toBe(1_800_000_000_000);
  });

  it("never touches a claimed doc, even when the export disagrees with it", async () => {
    const claimed: LegacyLoyaltyCustomer = parkedDoc({
      status: "claimed",
      claimedAtMs: 1_750_000_000_000,
      claimedPhone: "+639171234567",
      claimedByUid: "staff_ana",
      claimedByName: "Ana Reyes",
      idVerified: true,
      newPoints: 4,
    });
    const { db, store, sets } = makeFakeDb({ [`${LEGACY_COLLECTION}/juno-tabora`]: claimed });

    const result = await seedLegacyCustomers(db, [seedRow({ newPoints: 999 })], {
      source: SOURCE,
      write: true,
      nowMs: 1_800_000_000_000,
    });

    expect(result).toEqual({ created: 0, updated: 0, skippedClaimed: 1 });
    expect(sets).toHaveLength(0);
    expect(store.get(`${LEGACY_COLLECTION}/juno-tabora`)).toEqual(claimed);
  });

  it("counts but writes nothing on a dry run", async () => {
    const { db, store, batchCommits } = makeFakeDb();

    const result = await seedLegacyCustomers(db, [seedRow(), seedRow({ id: "mara-delfin" })], {
      source: SOURCE,
      write: false,
    });

    expect(result).toEqual({ created: 2, updated: 0, skippedClaimed: 0 });
    expect(store.size).toBe(0);
    expect(batchCommits).toEqual([]);
  });

  it("splits writes into batches of at most 400", async () => {
    const { db, batchCommits } = makeFakeDb();
    const rows = Array.from({ length: 905 }, (_, i) => seedRow({ id: `legacy-${i}` }));

    const result = await seedLegacyCustomers(db, rows, { source: SOURCE, write: true });

    expect(result.created).toBe(905);
    expect(batchCommits).toEqual([400, 400, 105]);
  });
});

describe("claimLegacyCustomer", () => {
  const okDb = () =>
    makeFakeDb({
      [`${LEGACY_COLLECTION}/juno-tabora`]: parkedDoc(),
      "customers/+639171234567": { phone: "+639171234567", name: "Juno T. Tabora", pointsBalance: 12 },
    });

  it("marks the row claimed and reports the points the owner still has to move", async () => {
    const { db, store } = okDb();

    const result = await claimLegacyCustomer(db, {
      id: "juno-tabora",
      phone: "0917 123 4567",
      idVerified: true,
      note: "Drivers license, matches altName",
      actorUid: "staff_ana",
      actorName: "Ana Reyes",
    });

    expect(result.transferPoints).toBe(4);
    expect(result.customerName).toBe("Juno T. Tabora");
    expect(result.row.status).toBe("claimed");
    // Loose input accepted, canonical +63 stored.
    expect(result.row.claimedPhone).toBe("+639171234567");
    expect(result.row.claimedByName).toBe("Ana Reyes");
    expect(result.row.claimNote).toBe("Drivers license, matches altName");
    expect(result.row.idVerified).toBe(true);

    const doc = store.get(`${LEGACY_COLLECTION}/juno-tabora`);
    expect(doc.status).toBe("claimed");
    expect(doc.claimedByUid).toBe("staff_ana");
    expect(typeof doc.claimedAtMs).toBe("number");
    // No points move here — the customer doc is untouched.
    expect(store.get("customers/+639171234567").pointsBalance).toBe(12);
  });

  it("refuses with 400 when the ID has not been verified", async () => {
    const { db, store } = okDb();

    await expect(
      claimLegacyCustomer(db, {
        id: "juno-tabora",
        phone: "09171234567",
        idVerified: false,
        actorUid: "staff_ana",
        actorName: "Ana Reyes",
      }),
    ).rejects.toMatchObject({ httpStatus: 400 });

    expect(store.get(`${LEGACY_COLLECTION}/juno-tabora`).status).toBe("parked");
  });

  it("refuses with 400 on an unparseable phone number", async () => {
    const { db } = okDb();

    await expect(
      claimLegacyCustomer(db, {
        id: "juno-tabora",
        phone: "12345",
        idVerified: true,
        actorUid: "staff_ana",
        actorName: "Ana Reyes",
      }),
    ).rejects.toMatchObject({ httpStatus: 400 });
  });

  it("refuses with 404 when there is no Hub loyalty card at that number", async () => {
    const { db, store } = makeFakeDb({
      [`${LEGACY_COLLECTION}/juno-tabora`]: parkedDoc(),
    });

    await expect(
      claimLegacyCustomer(db, {
        id: "juno-tabora",
        phone: "09171234567",
        idVerified: true,
        actorUid: "staff_ana",
        actorName: "Ana Reyes",
      }),
    ).rejects.toMatchObject({
      httpStatus: 404,
      message: "No loyalty card at that number yet — ask the customer to sign up in the Hub first.",
    });

    expect(store.get(`${LEGACY_COLLECTION}/juno-tabora`).status).toBe("parked");
  });

  it("refuses with 409 naming who claimed it and when", async () => {
    const claimedAtMs = Date.UTC(2026, 0, 15, 3, 30, 0);
    const { db } = makeFakeDb({
      [`${LEGACY_COLLECTION}/juno-tabora`]: parkedDoc({
        status: "claimed",
        claimedAtMs,
        claimedByUid: "staff_bea",
        claimedByName: "Bea Lim",
        claimedPhone: "+639998887777",
        idVerified: true,
      }),
      "customers/+639171234567": { phone: "+639171234567", name: "Juno T. Tabora" },
    });

    let err: LegacyLoyaltyError | null = null;
    try {
      await claimLegacyCustomer(db, {
        id: "juno-tabora",
        phone: "09171234567",
        idVerified: true,
        actorUid: "staff_ana",
        actorName: "Ana Reyes",
      });
    } catch (e) {
      err = e as LegacyLoyaltyError;
    }

    expect(err).toBeInstanceOf(LegacyLoyaltyError);
    expect(err!.httpStatus).toBe(409);
    expect(err!.message).toContain("Bea Lim");
    expect(err!.message).toContain(new Date(claimedAtMs).toISOString());
  });

  it("refuses with 404 when the legacy row itself does not exist", async () => {
    const { db } = makeFakeDb({
      "customers/+639171234567": { phone: "+639171234567", name: "Juno T. Tabora" },
    });

    await expect(
      claimLegacyCustomer(db, {
        id: "ghost-row",
        phone: "09171234567",
        idVerified: true,
        actorUid: "staff_ana",
        actorName: "Ana Reyes",
      }),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe("unclaimLegacyCustomer", () => {
  it("reverts to parked, clears the claim fields and records the reversal", async () => {
    const { db, store } = makeFakeDb({
      [`${LEGACY_COLLECTION}/juno-tabora`]: parkedDoc({
        status: "claimed",
        claimedAtMs: 1_750_000_000_000,
        claimedPhone: "+639171234567",
        claimedByUid: "staff_bea",
        claimedByName: "Bea Lim",
        claimNote: "wrong person",
        idVerified: true,
      }),
    });

    const row = await unclaimLegacyCustomer(db, { id: "juno-tabora", actorUid: "staff_ana" });

    expect(row.status).toBe("parked");
    expect(row.claimedPhone).toBeUndefined();
    expect(row.claimedByName).toBeUndefined();
    expect(row.idVerified).toBeUndefined();
    expect(row.history).toEqual([
      { unclaimedAtMs: expect.any(Number), unclaimedByUid: "staff_ana" },
    ]);

    const doc = store.get(`${LEGACY_COLLECTION}/juno-tabora`);
    expect(doc.status).toBe("parked");
    expect("claimedByUid" in doc).toBe(false);
    expect("claimNote" in doc).toBe(false);
    expect(doc.history).toHaveLength(1);
    // The seed fields survive the reversal — the row is claimable again.
    expect(doc.newPoints).toBe(4);
  });

  it("refuses with 409 when the row is already parked", async () => {
    const { db } = makeFakeDb({ [`${LEGACY_COLLECTION}/juno-tabora`]: parkedDoc() });

    await expect(
      unclaimLegacyCustomer(db, { id: "juno-tabora", actorUid: "staff_ana" }),
    ).rejects.toMatchObject({ httpStatus: 409 });
  });
});

describe("summarizeLegacy", () => {
  it("splits counts and points across parked and claimed", () => {
    const rows: LegacyLoyaltyCustomer[] = [
      parkedDoc({ id: "a", newPoints: 4 }),
      parkedDoc({ id: "b", newPoints: 11 }),
      parkedDoc({ id: "c", newPoints: 7, status: "claimed" }),
    ];

    expect(summarizeLegacy(rows)).toEqual({
      parked: 2,
      claimed: 1,
      pointsRemaining: 15,
      pointsClaimed: 7,
    });
  });

  it("returns zeroes for an empty list", () => {
    expect(summarizeLegacy([])).toEqual({
      parked: 0,
      claimed: 0,
      pointsRemaining: 0,
      pointsClaimed: 0,
    });
  });
});
