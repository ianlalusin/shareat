import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldPath: class {
    parts: string[];
    constructor(...parts: string[]) { this.parts = parts; }
  },
}));

import { findCustomers, MAX_RESULTS } from "./find-customer";

const STORE = "storeA";

function custDoc(phone: string, name: string, pts: number, lastVisit?: number) {
  return {
    id: phone,
    data: () => ({
      name,
      pointsBalance: pts,
      ...(lastVisit ? { storeVisits: { [STORE]: { visits: 1, lastVisitAtMs: lastVisit } } } : {}),
    }),
  };
}

function fakeDb(all: ReturnType<typeof custDoc>[]) {
  let scanned = 0;
  const db: any = {
    doc: (path: string) => ({
      get: async () => {
        const phone = path.replace("customers/", "");
        const d = all.find((x) => x.id === phone);
        return { exists: !!d, id: phone, data: () => d?.data() };
      },
    }),
    collection: (_: string) => {
      let limitN = Infinity;
      const q: any = {
        where: (fp: any, op: string, v: number) => {
          expect(fp.parts).toEqual(["storeVisits", STORE, "lastVisitAtMs"]);
          expect(op).toBe(">");
          expect(v).toBe(0);
          return q;
        },
        orderBy: (fp: any, dir: string) => {
          expect(fp.parts).toEqual(["storeVisits", STORE, "lastVisitAtMs"]);
          expect(dir).toBe("desc");
          return q;
        },
        limit: (n: number) => { limitN = n; return q; },
        get: async () => {
          const rows = all
            .filter((d) => (d.data() as any).storeVisits?.[STORE]?.lastVisitAtMs > 0)
            .sort((a, b) => (b.data() as any).storeVisits[STORE].lastVisitAtMs - (a.data() as any).storeVisits[STORE].lastVisitAtMs)
            .slice(0, limitN);
          scanned = rows.length;
          return { docs: rows };
        },
      };
      return q;
    },
  };
  return { db, scanned: () => scanned };
}

describe("findCustomers", () => {
  it("exact phone returns that customer even if they never visited this store", async () => {
    const { db } = fakeDb([custDoc("+639171234567", "Maria Santos", 50)]);
    const r = await findCustomers(db, { storeId: STORE, q: "0917 123 4567" });
    expect(r).toEqual({ kind: "phone", results: [{ phone: "+639171234567", name: "Maria Santos", pointsBalance: 50 }] });
  });

  it("exact phone with no account returns empty results", async () => {
    const { db } = fakeDb([]);
    const r = await findCustomers(db, { storeId: STORE, q: "09171234567" });
    expect(r).toEqual({ kind: "phone", results: [] });
  });

  it("name search only sees customers who visited this store, case-insensitive", async () => {
    const { db } = fakeDb([
      custDoc("+639170000001", "Maria Santos", 10, 200),
      custDoc("+639170000002", "Marites Cruz", 20, 100),
      custDoc("+639170000003", "Maria Other-Branch", 30), // never visited storeA
    ]);
    const r = await findCustomers(db, { storeId: STORE, q: "mari" });
    expect(r.kind).toBe("name");
    expect(r.results.map((x) => x.name)).toEqual(["Maria Santos", "Marites Cruz"]);
  });

  it("caps results at MAX_RESULTS", async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      custDoc(`+63917000${String(1000 + i)}`, `Ana ${String(i).padStart(2, "0")}`, 0, 1000 + i));
    const { db } = fakeDb(rows);
    const r = await findCustomers(db, { storeId: STORE, q: "ana" });
    expect(r.results).toHaveLength(MAX_RESULTS);
  });

  it("incomplete query does no reads and returns nothing", async () => {
    const { db } = fakeDb([]);
    db.doc = () => { throw new Error("should not read"); };
    db.collection = () => { throw new Error("should not read"); };
    expect(await findCustomers(db, { storeId: STORE, q: "a" })).toEqual({ kind: "incomplete", results: [] });
    expect(await findCustomers(db, { storeId: STORE, q: "0917" })).toEqual({ kind: "incomplete", results: [] });
  });
});
