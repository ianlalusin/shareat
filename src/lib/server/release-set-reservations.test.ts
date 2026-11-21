import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
    arrayUnion: (...values: any[]) => ({ __sentinel: "arrayUnion", values }),
    arrayRemove: (...values: any[]) => ({ __sentinel: "arrayRemove", values }),
  },
  Timestamp: { now: () => ({ __sentinel: "timestamp" }) },
}));

import { releaseSetReservationsForStore } from "./release-set-reservations";

const STORE = "S1";
const NOW = 1_000_000;
const base = (over: Record<string, any> = {}) => ({
  kind: "set_reservation",
  status: "accepted",
  releaseAtMs: NOW - 1,
  contact: { name: "Maria" },
  lines: [{ lineId: "l1", productId: "grp", variantId: "v1", name: "Sharing Set - Set 3", qty: 1 }],
  ...over,
});

function harness(orders: Record<string, any>, inventory: Record<string, any> = { v1: { kitchenLocationId: "grill", kitchenLocationName: "Grill" } }) {
  const docs: Record<string, any> = {};
  for (const [id, o] of Object.entries(orders)) docs[`stores/${STORE}/onlineOrders/${id}`] = o;
  for (const [id, i] of Object.entries(inventory)) docs[`stores/${STORE}/inventory/${id}`] = i;
  const sets: { path: string; data: any }[] = [];
  const queries: [string, string][][] = [];
  const ref = (path: string) => ({ path, id: path.split("/").pop()! });
  const snapOf = (r: any) => ({ exists: docs[r.path] !== undefined, data: () => docs[r.path], id: r.id });
  const db: any = {
    doc: ref,
    collection: (path: string) => {
      // Chainable where(field, "==", value), recording each filter so tests can assert the query.
      const query = (filters: [string, string][]) => ({
        where: (f: string, _op: string, value: string) => query([...filters, [f, value]]),
        get: async () => {
          queries.push(filters);
          return {
            docs: Object.keys(docs)
              .filter((p) => p.startsWith(`${path}/`) && filters.every(([f, v]) => docs[p][f] === v))
              .map((p) => ({ id: p.split("/").pop()!, data: () => docs[p] })),
          };
        },
      });
      return query([]);
    },
    runTransaction: async (fn: any) =>
      fn({
        get: async (r: any) => snapOf(r),
        getAll: async (...rs: any[]) => rs.map(snapOf),
        set: (r: any, data: any) => {
          sets.push({ path: r.path, data });
        },
        update: (r: any, data: any) => {
          docs[r.path] = { ...docs[r.path], ...data };
        },
      }),
  };
  return { db, docs, sets, queries };
}

const ordPath = (id: string) => `stores/${STORE}/onlineOrders/${id}`;

describe("releaseSetReservationsForStore", () => {
  it("queries only accepted set reservations, not every accepted online order (audit POS-04)", async () => {
    const h = harness({ A: base(), W: base({ kind: "website" }) });
    await releaseSetReservationsForStore(h.db, STORE, NOW);
    expect(h.queries[0]).toEqual([
      ["status", "accepted"],
      ["kind", "set_reservation"],
    ]);
  });

  it("sends a due, confirmed reservation to the kitchen and marks it preparing", async () => {
    const h = harness({ A: base() });
    const r = await releaseSetReservationsForStore(h.db, STORE, NOW);
    expect(r).toEqual({ released: 1, skipped: 0 });
    expect(h.sets.map((s) => s.path)).toContain(`${ordPath("A")}/kitchentickets/A_0`);
    expect(h.sets.map((s) => s.path)).toContain(`stores/${STORE}/rtKdsTickets/grill`);
    const o = h.docs[ordPath("A")];
    expect(o.status).toBe("preparing");
    expect(o.kitchenReleasedAtMs).toBe(NOW);
    expect(o.statusHistory.values[0]).toMatchObject({ from: "accepted", to: "preparing", type: "auto_release" });
  });

  it("a second run releases nothing and writes no more tickets", async () => {
    const h = harness({ A: base() });
    await releaseSetReservationsForStore(h.db, STORE, NOW);
    const ticketWrites = h.sets.length;
    const again = await releaseSetReservationsForStore(h.db, STORE, NOW + 600_000);
    expect(again).toEqual({ released: 0, skipped: 0 });
    expect(h.sets.length).toBe(ticketWrites);
  });

  it("leaves pending, cancelled, rejected, not-yet-due and non-reservation orders alone", async () => {
    const h = harness({
      P: base({ status: "pending" }),
      C: base({ status: "cancelled" }),
      R: base({ status: "rejected" }),
      F: base({ releaseAtMs: NOW + 1 }),
      W: base({ kind: "website" }),
    });
    const r = await releaseSetReservationsForStore(h.db, STORE, NOW);
    expect(r.released).toBe(0);
    expect(h.sets).toHaveLength(0);
    expect(h.docs[ordPath("P")].status).toBe("pending");
  });

  it("does NOT mark the order released when no ticket could be built, so the next run retries", async () => {
    const h = harness({ A: base() }, {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await releaseSetReservationsForStore(h.db, STORE, NOW);
    expect(r).toEqual({ released: 0, skipped: 1 });
    expect(h.sets).toHaveLength(0);
    expect(h.docs[ordPath("A")].status).toBe("accepted");
    expect(h.docs[ordPath("A")].kitchenReleasedAtMs).toBeUndefined();
    expect(err).toHaveBeenCalled();
    // once the kitchen station exists, the next run releases it
    h.docs[`stores/${STORE}/inventory/v1`] = { kitchenLocationId: "grill", kitchenLocationName: "Grill" };
    expect(await releaseSetReservationsForStore(h.db, STORE, NOW + 600_000)).toEqual({ released: 1, skipped: 0 });
    err.mockRestore();
  });

  it("one order that throws does not stop the others", async () => {
    const h = harness({ A: base(), B: base() });
    const real = h.db.runTransaction;
    let calls = 0;
    h.db.runTransaction = async (fn: any) => {
      if (++calls === 1) throw new Error("boom");
      return real(fn);
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await releaseSetReservationsForStore(h.db, STORE, NOW);
    expect(r.released).toBe(1);
    expect(r.skipped).toBe(1);
    err.mockRestore();
  });
});
