import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => ({ __sentinel: "serverTimestamp" }) },
}));

import { getActiveStores } from "./active-stores-cache";

type FakeTimestamp = { toMillis: () => number };
const ts = (ms: number): FakeTimestamp => ({ toMillis: () => ms });

/**
 * Minimal fake covering only what active-stores-cache.ts calls:
 * db.doc(path).get()/.set(), db.collection(name).where(...).get().
 */
function makeFakeDb(opts: {
  cachedStores?: any[] | null;
  cachedUpdatedAt?: FakeTimestamp | null | "corrupt";
  storeDocs: Array<{ id: string; data: Record<string, any> }>;
  failCacheWrite?: boolean;
}) {
  let cachedStores = opts.cachedStores ?? null;
  let cachedUpdatedAt = opts.cachedUpdatedAt ?? null;
  let scanCount = 0;
  const writes: any[] = [];

  const db = {
    doc: (path: string) => {
      expect(path).toBe("system/activeStoresCache");
      return {
        get: async () => ({
          get: (field: string) => (field === "stores" ? cachedStores ?? undefined : cachedUpdatedAt ?? undefined),
        }),
        set: async (data: any) => {
          if (opts.failCacheWrite) throw new Error("simulated cache write failure");
          writes.push(data);
          cachedStores = data.stores;
          cachedUpdatedAt = ts(Date.now());
        },
      };
    },
    collection: (name: string) => {
      expect(name).toBe("stores");
      return {
        where: (field: string, op: string, value: unknown) => ({
          get: async () => {
            scanCount++;
            expect([field, op]).toEqual(["isActive", "=="]);
            const docs = opts.storeDocs
              .filter((d) => d.data[field as string] === value)
              .map((d) => ({ id: d.id, data: () => d.data }));
            return { docs };
          },
        }),
      };
    },
  };

  return { db: db as any, getScanCount: () => scanCount, getWrites: () => writes };
}

describe("getActiveStores", () => {
  it("cold start: no cache doc yet, scans and populates the cache", async () => {
    const { db, getScanCount, getWrites } = makeFakeDb({
      storeDocs: [{ id: "s1", data: { isActive: true, name: "Lipa" } }],
    });

    const result = await getActiveStores(db);

    expect(getScanCount()).toBe(1);
    expect(result).toEqual([
      {
        id: "s1",
        name: "Lipa",
        address: null,
        isActive: true,
        aiEnabled: null,
        forecastConfig: null,
        geo: null,
        openingTime: null,
        closingTime: null,
      },
    ]);
    expect(getWrites()).toHaveLength(1);
  });

  it("never writes `undefined` into the cache doc for a store missing optional fields (regression: Admin SDK rejects undefined)", async () => {
    // A store doc that never had forecastConfig/name/address/aiEnabled set —
    // realistic for any store whose manager never opened Forecast Settings.
    const { db, getWrites } = makeFakeDb({
      storeDocs: [{ id: "s1", data: { isActive: true } }],
    });

    const result = await getActiveStores(db);

    const serialize = (v: unknown) => JSON.stringify(v, (_k, val) => (val === undefined ? "__UNDEFINED__" : val));
    expect(serialize(getWrites()[0])).not.toContain("__UNDEFINED__");
    expect(serialize(result)).not.toContain("__UNDEFINED__");
    expect(result[0].name).toBeNull();
    expect(result[0].forecastConfig).toBeNull();
  });

  it("fresh cache (within TTL) is served without scanning", async () => {
    const { db, getScanCount } = makeFakeDb({
      cachedStores: [{ id: "s1", name: "Lipa" }],
      cachedUpdatedAt: ts(Date.now() - 5_000), // 5s ago
      storeDocs: [{ id: "s1", data: { isActive: true, name: "Lipa" } }],
    });

    const result = await getActiveStores(db, { ttlMs: 20 * 60 * 1000 });

    expect(getScanCount()).toBe(0);
    expect(result).toEqual([{ id: "s1", name: "Lipa" }]);
  });

  it("expired cache triggers a rescan", async () => {
    const { db, getScanCount } = makeFakeDb({
      cachedStores: [{ id: "stale", name: "Old" }],
      cachedUpdatedAt: ts(Date.now() - 30 * 60 * 1000), // 30 min ago
      storeDocs: [{ id: "s1", data: { isActive: true, name: "Lipa" } }],
    });

    const result = await getActiveStores(db, { ttlMs: 20 * 60 * 1000 });

    expect(getScanCount()).toBe(1);
    expect(result.map((s) => s.id)).toEqual(["s1"]);
  });

  it("a corrupt/wrong-shape updatedAt is treated as expired, not thrown", async () => {
    const { db, getScanCount } = makeFakeDb({
      cachedStores: [{ id: "s1" }],
      cachedUpdatedAt: "corrupt" as any, // no .toMillis()
      storeDocs: [{ id: "s1", data: { isActive: true } }],
    });

    await expect(getActiveStores(db)).resolves.not.toThrow();
    expect(getScanCount()).toBe(1);
  });

  it("still returns the freshly-scanned result even if the cache write itself fails", async () => {
    const { db, getScanCount } = makeFakeDb({
      storeDocs: [{ id: "s1", data: { isActive: true, name: "Lipa" } }],
      failCacheWrite: true,
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await getActiveStores(db);

    expect(getScanCount()).toBe(1);
    expect(result[0].id).toBe("s1");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
