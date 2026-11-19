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
  const ref = (path: string) => ({ path, id: path.split("/").pop()! });
  const snapOf = (r: any) => ({ exists: docs[r.path] !== undefined, data: () => docs[r.path], id: r.id });
  const db: any = {
    doc: ref,
    collection: (path: string) => ({
      where: (_f: string, _op: string, value: string) => ({
        get: async () => ({
          docs: Object.keys(docs)
            .filter((p) => p.startsWith(`${path}/`) && docs[p].status === value)
            .map((p) => ({ id: p.split("/").pop()!, data: () => docs[p] })),
        }),
      }),
    }),
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
  return { db, docs, sets };
}

const ordPath = (id: string) => `stores/${STORE}/onlineOrders/${id}`;

describe("releaseSetReservationsForStore", () => {
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

  it("still marks the order preparing when no line has a kitchen location (0 tickets)", async () => {
    const h = harness({ A: base() }, {});
    const r = await releaseSetReservationsForStore(h.db, STORE, NOW);
    expect(r.released).toBe(1);
    expect(h.sets.filter((s) => s.path.includes("/kitchentickets/"))).toHaveLength(0);
    expect(h.docs[ordPath("A")].status).toBe("preparing");
  });
});
