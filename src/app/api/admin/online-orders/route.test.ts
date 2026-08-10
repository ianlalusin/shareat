import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Route-level tests for the online-orders admin op endpoint.
 *
 * The route's decision logic lives inside a Firestore transaction, so it is
 * exercised here against an in-memory double rather than extracted: the things
 * worth protecting (which payment fields get written, which get left alone, and
 * which string lands in analyticsV2.mop) are only observable as write payloads.
 *
 * FieldValue/Timestamp are mocked into recognisable sentinels so assertions can
 * read the update payload directly instead of unpicking Admin SDK internals.
 */

const ACTOR_UID = "staff_uid_1";
const ACTOR_NAME = "Ana Cashier";
const STORE = "XbkyEgZqunmj2wzhicNf";
const ORDER = "ord_1";

const ORDER_PATH = `stores/${STORE}/onlineOrders/${ORDER}`;
const RECEIPT_PATH = `stores/${STORE}/receipts/${ORDER}`;

// --- module mocks ----------------------------------------------------------

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
    arrayUnion: (...values: any[]) => ({ __sentinel: "arrayUnion", values }),
    arrayRemove: (...values: any[]) => ({ __sentinel: "arrayRemove", values }),
    delete: () => ({ __sentinel: "delete" }),
  },
  Timestamp: {
    now: () => ({ __sentinel: "timestamp" }),
  },
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async () => ({ uid: ACTOR_UID, name: ACTOR_NAME }),
  }),
  getAdminDb: () => harness.db,
}));

vi.mock("@/lib/server/active-staff-check", () => ({
  requireActiveStaff: async () => ({
    isPlatformAdmin: false,
    assignedStoreIds: [STORE],
    role: mockStaffRole,
  }),
}));

vi.mock("@/lib/server/analytics/applyAnalyticsDeltaServer", () => ({
  applyAnalyticsDeltaServer: vi.fn(() => {}),
}));

vi.mock("@/lib/server/notify-customer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/notify-customer")>();
  return { ...actual, notifyOrderStatusChange: vi.fn(async () => {}) };
});

import { POST } from "./route";

// --- in-memory firestore double --------------------------------------------

type Update = { path: string; data: any };
type SetOp = { path: string; data: any };

function makeHarness(docs: Record<string, any>) {
  const updates: Update[] = [];
  const sets: SetOp[] = [];
  let autoIdCounter = 0;

  const makeRef = (path: string) => ({
    path,
    id: path.split("/").pop() as string,
    get: async () => ({ exists: docs[path] !== undefined, data: () => docs[path] }),
  });

  const db = {
    doc: (path: string) => makeRef(path),
    // Only .doc() (auto-id) is exercised today, by the activity-log writes in
    // op: kitchen-ticket-status.
    collection: (path: string) => ({
      doc: () => makeRef(`${path}/auto_${++autoIdCounter}`),
    }),
    runTransaction: async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        get: async (ref: any) => ({
          exists: docs[ref.path] !== undefined,
          data: () => docs[ref.path],
          id: ref.id,
        }),
        getAll: async (...refs: any[]) =>
          refs.map((ref) => ({
            exists: docs[ref.path] !== undefined,
            data: () => docs[ref.path],
            id: ref.id,
          })),
        update: (ref: any, data: any) => {
          updates.push({ path: ref.path, data });
        },
        set: (ref: any, data: any) => {
          sets.push({ path: ref.path, data });
          // Materialise so the follow-up analytics transaction can read it back.
          docs[ref.path] = { ...(docs[ref.path] ?? {}), ...data };
        },
      };
      return fn(tx);
    },
  };

  return { db, docs, updates, sets };
}

let harness: ReturnType<typeof makeHarness>;
let mockStaffRole: string | undefined;

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/admin/online-orders", {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function orderUpdate(): any {
  const found = harness.updates.filter((u) => u.path === ORDER_PATH);
  return found.length ? found[found.length - 1].data : null;
}

function historyEntry(update: any): any {
  return update?.statusHistory?.values?.[0] ?? null;
}

function historyEntries(update: any): any[] {
  return update?.statusHistory?.values ?? [];
}

/** A completable order: enough shape for the receipt/analytics path to run. */
function baseOrder(over: Record<string, any> = {}) {
  return {
    status: "pending",
    grandTotal: 500,
    subtotal: 500,
    deliveryFee: 0,
    contact: { name: "Maria", phone: "+639171234567" },
    fulfillment: { type: "pickup" },
    lines: [
      { lineId: "l1", productId: "p1", name: "Unli Samgyup", category: "Mains", unitPrice: 500, qty: 1 },
    ],
    payment: { method: "manual" },
    ...over,
  };
}

function seed(order: Record<string, any>) {
  harness = makeHarness({
    [ORDER_PATH]: order,
    [`stores/${STORE}/receiptSettings/main`]: { receiptNoFormat: "SELIP-######" },
    [`stores/${STORE}/counters/receipts`]: { seq: 41 },
    [`stores/${STORE}`]: { name: "Lipa" },
  });
}

function seedWithInventory(order: Record<string, any>, inventory: Record<string, any> = {}) {
  const docs: Record<string, any> = {
    [ORDER_PATH]: order,
    [`stores/${STORE}/receiptSettings/main`]: { receiptNoFormat: "SELIP-######" },
    [`stores/${STORE}/counters/receipts`]: { seq: 41 },
    [`stores/${STORE}`]: { name: "Lipa" },
  };
  for (const [invId, data] of Object.entries(inventory)) {
    docs[`stores/${STORE}/inventory/${invId}`] = data;
  }
  harness = makeHarness(docs);
}

beforeEach(() => {
  seed(baseOrder());
  mockStaffRole = undefined;
});

// --- confirm-payment -------------------------------------------------------

describe("op: confirm-payment", () => {
  it("moves a pending_payment order to pending and writes all six payment fields", async () => {
    seed(baseOrder({ status: "pending_payment" }));

    const res = await post({ op: "confirm-payment", storeId: STORE, orderId: ORDER, methodLabel: "GCash" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, status: "pending", paid: true });

    const u = orderUpdate();
    expect(u.status).toBe("pending");
    expect(u["payment.paid"]).toBe(true);
    expect(u["payment.methodLabel"]).toBe("GCash");
    expect(typeof u["payment.settledAtMs"]).toBe("number");
    expect(u["payment.confirmedByUid"]).toBe(ACTOR_UID);
    expect(u["payment.confirmedByName"]).toBe(ACTOR_NAME);
    expect(u["payment.confirmedVia"]).toBe("manual_wallet");

    // A revive writes two history entries in the same arrayUnion call: the
    // "money arrived" fact and the "status moved" fact, kept separate so
    // "transition" keeps meaning the same thing everywhere in this file.
    const entries = historyEntries(u);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      from: "pending_payment",
      to: "pending_payment",
      type: "payment_confirmed",
    });
    expect(entries[1]).toMatchObject({
      from: "pending_payment",
      to: "pending",
      type: "transition",
      reason: "Payment confirmed",
    });
    expect(entries[1].atClientMs).toBe(entries[0].atClientMs);
  });

  it("revives an expired order to pending", async () => {
    seed(baseOrder({ status: "expired" }));

    const res = await post({ op: "confirm-payment", storeId: STORE, orderId: ORDER, methodLabel: "Maya" });
    expect(res.status).toBe(200);
    const u = orderUpdate();
    expect(u.status).toBe("pending");

    const entries = historyEntries(u);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      from: "expired",
      to: "expired",
      type: "payment_confirmed",
    });
    expect(entries[1]).toMatchObject({
      from: "expired",
      to: "pending",
      type: "transition",
      reason: "Payment confirmed",
    });
    expect(entries[1].atClientMs).toBe(entries[0].atClientMs);
  });

  it("leaves status alone on an accepted order while still marking it paid", async () => {
    seed(baseOrder({ status: "accepted" }));

    const res = await post({ op: "confirm-payment", storeId: STORE, orderId: ORDER, methodLabel: "GCash" });
    expect(res.status).toBe(200);

    const u = orderUpdate();
    expect(u["payment.paid"]).toBe(true);
    // The key must be absent entirely — writing status:"accepted" would be a
    // no-op today but would start lying the moment the shape changes.
    expect("status" in u).toBe(false);
    await expect(res.json()).resolves.toMatchObject({ status: "accepted" });
  });

  it("writes a payment_confirmed history entry with from === to === current status", async () => {
    seed(baseOrder({ status: "pending_payment" }));

    await post({
      op: "confirm-payment",
      storeId: STORE,
      orderId: ORDER,
      methodLabel: "GCash",
      note: "Sender said Ana G.",
    });

    expect(historyEntry(orderUpdate())).toMatchObject({
      from: "pending_payment",
      to: "pending_payment",
      byUid: ACTOR_UID,
      byName: ACTOR_NAME,
      type: "payment_confirmed",
      note: "Sender said Ana G.",
    });
  });

  it("omits the note key when no note is given", async () => {
    await post({ op: "confirm-payment", storeId: STORE, orderId: ORDER, methodLabel: "GCash" });
    expect("note" in historyEntry(orderUpdate())).toBe(false);
  });

  it("400s on a second confirm of the same order", async () => {
    seed(baseOrder({ payment: { paid: true, methodLabel: "GCash" } }));

    const res = await post({ op: "confirm-payment", storeId: STORE, orderId: ORDER, methodLabel: "Maya" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "This order is already marked paid." });
    expect(orderUpdate()).toBeNull();
  });

  it("400s when the order already has a receipt", async () => {
    seed(baseOrder({ receiptId: ORDER, payment: { method: "manual" } }));

    const res = await post({ op: "confirm-payment", storeId: STORE, orderId: ORDER, methodLabel: "GCash" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "This order already has a receipt." });
  });

  it.each(["completed", "cancelled", "rejected"])("400s on a %s order", async (status) => {
    seed(baseOrder({ status }));

    const res = await post({ op: "confirm-payment", storeId: STORE, orderId: ORDER, methodLabel: "GCash" });
    expect(res.status).toBe(400);
    expect(orderUpdate()).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["missing", undefined],
  ])("400s on a %s methodLabel", async (_name, methodLabel) => {
    const res = await post({ op: "confirm-payment", storeId: STORE, orderId: ORDER, methodLabel });
    expect(res.status).toBe(400);
    expect(orderUpdate()).toBeNull();
  });

  it("stores methodLabel trimmed and capped at 60 chars", async () => {
    await post({
      op: "confirm-payment",
      storeId: STORE,
      orderId: ORDER,
      methodLabel: `  ${"G".repeat(80)}  `,
    });
    expect(orderUpdate()["payment.methodLabel"]).toBe("G".repeat(60));
  });

  it("writes exactly one history entry on a non-revive confirm (accepted order)", async () => {
    seed(baseOrder({ status: "accepted" }));

    await post({ op: "confirm-payment", storeId: STORE, orderId: ORDER, methodLabel: "GCash" });

    // A second entry here would be a phantom transition: "accepted" never
    // moved, so there is nothing for a "transition" entry to describe.
    const entries = historyEntries(orderUpdate());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      from: "accepted",
      to: "accepted",
      type: "payment_confirmed",
    });
  });
});

// --- unconfirm-payment -----------------------------------------------------

describe("op: unconfirm-payment", () => {
  const paidOrder = () =>
    baseOrder({
      payment: {
        paid: true,
        methodLabel: "GCash",
        settledAtMs: 111,
        confirmedByUid: ACTOR_UID,
        confirmedByName: ACTOR_NAME,
        confirmedVia: "manual_wallet",
      },
    });

  it("clears every confirm field and leaves status untouched", async () => {
    seed(paidOrder());

    const res = await post({ op: "unconfirm-payment", storeId: STORE, orderId: ORDER, reason: "Wrong order." });
    expect(res.status).toBe(200);

    const u = orderUpdate();
    expect(u["payment.paid"]).toBe(false);
    for (const key of [
      "payment.methodLabel",
      "payment.settledAtMs",
      "payment.confirmedByUid",
      "payment.confirmedByName",
      "payment.confirmedVia",
    ]) {
      expect(u[key]).toEqual({ __sentinel: "delete" });
    }
    expect("status" in u).toBe(false);
    expect(historyEntry(u)).toMatchObject({ type: "payment_unconfirmed", reason: "Wrong order." });
  });

  it("refuses once a receipt exists", async () => {
    seed({ ...paidOrder(), receiptId: ORDER, receiptNumber: "SELIP-000042" });

    const res = await post({ op: "unconfirm-payment", storeId: STORE, orderId: ORDER, reason: "Mistake." });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Cannot un-mark payment after the receipt is issued.",
    });
    expect(orderUpdate()).toBeNull();
  });

  it("refuses when the order was never marked paid", async () => {
    const res = await post({ op: "unconfirm-payment", storeId: STORE, orderId: ORDER, reason: "Mistake." });
    expect(res.status).toBe(400);
    expect(orderUpdate()).toBeNull();
  });

  it("requires a reason", async () => {
    seed(paidOrder());
    const res = await post({ op: "unconfirm-payment", storeId: STORE, orderId: ORDER });
    expect(res.status).toBe(400);
    expect(orderUpdate()).toBeNull();
  });
});

// --- completion / payment interaction --------------------------------------

describe("completion does not clobber an earlier payment", () => {
  it("leaves settledAtMs and paid alone when the order was already marked paid", async () => {
    seed(
      baseOrder({
        status: "ready",
        payment: { paid: true, methodLabel: "GCash", settledAtMs: 111, confirmedVia: "manual_wallet" },
      })
    );

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "completed" });
    expect(res.status).toBe(200);

    const u = orderUpdate();
    expect(u.status).toBe("completed");
    expect(u.receiptNumber).toBe("SELIP-000042");
    // The regression this exists to prevent: completion must not restamp when
    // the money arrived, nor re-assert paid over a field it does not own.
    expect("payment.settledAtMs" in u).toBe(false);
    expect("payment.paid" in u).toBe(false);
  });

  it("still stamps paid and settledAtMs when completing an unpaid order", async () => {
    seed(baseOrder({ status: "ready" }));

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "completed" });
    expect(res.status).toBe(200);

    const u = orderUpdate();
    expect(u["payment.paid"]).toBe(true);
    expect(typeof u["payment.settledAtMs"]).toBe("number");
  });
});

// --- paymentLabel, observed through the analytics mop key ------------------

describe("paymentLabel drives the analyticsV2.mop key", () => {
  async function mopKeyAfterCompleting(order: Record<string, any>) {
    seed({ ...order, status: "ready" });
    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "completed" });
    expect(res.status).toBe(200);
    const receipt = harness.sets.find((s) => s.path === RECEIPT_PATH);
    return Object.keys(receipt!.data.analytics.mop);
  }

  it("uses methodLabel verbatim when present", async () => {
    expect(
      await mopKeyAfterCompleting(baseOrder({ payment: { paid: true, methodLabel: "GCash" } }))
    ).toEqual(["GCash"]);
  });

  it("prefers methodLabel over the paymongo branch", async () => {
    expect(
      await mopKeyAfterCompleting(
        baseOrder({ payment: { paid: true, method: "paymongo", methodLabel: "Maya" } })
      )
    ).toEqual(["Maya"]);
  });

  // The three no-methodLabel branches must stay byte-identical to today's
  // output, or an existing revenue row silently splits in two.
  it("falls back to Online (PayMongo) for a paymongo order", async () => {
    expect(await mopKeyAfterCompleting(baseOrder({ payment: { method: "paymongo" } }))).toEqual([
      "Online (PayMongo)",
    ]);
  });

  it("falls back to Cash on Delivery for a delivery order", async () => {
    expect(
      await mopKeyAfterCompleting(baseOrder({ fulfillment: { type: "delivery" } }))
    ).toEqual(["Cash on Delivery"]);
  });

  it("falls back to Pay at Counter for a pickup order", async () => {
    expect(await mopKeyAfterCompleting(baseOrder({ fulfillment: { type: "pickup" } }))).toEqual([
      "Pay at Counter",
    ]);
  });

  it("ignores a blank methodLabel and uses the fallback", async () => {
    expect(
      await mopKeyAfterCompleting(baseOrder({ payment: { methodLabel: "   " } }))
    ).toEqual(["Pay at Counter"]);
  });
});

// --- NEXT_STATES: expired revive -------------------------------------------

describe("transition: expired", () => {
  it("allows expired -> pending", async () => {
    seed(baseOrder({ status: "expired" }));
    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "pending" });
    expect(res.status).toBe(200);
    expect(orderUpdate().status).toBe("pending");
  });

  it("still refuses expired -> cancelled", async () => {
    seed(baseOrder({ status: "expired" }));
    const res = await post({
      op: "transition",
      storeId: STORE,
      orderId: ORDER,
      toStatus: "cancelled",
      reason: "Customer changed mind.",
    });
    expect(res.status).toBe(400);
    expect(orderUpdate()).toBeNull();
  });

  it("still refuses expired -> completed", async () => {
    seed(baseOrder({ status: "expired" }));
    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "completed" });
    expect(res.status).toBe(400);
    expect(orderUpdate()).toBeNull();
  });
});

// --- op dispatch -----------------------------------------------------------

describe("op dispatch", () => {
  it("rejects an unknown op", async () => {
    const res = await post({ op: "refund-everything", storeId: STORE, orderId: ORDER });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Unknown op: refund-everything" });
  });

  it("does not require toStatus for the payment ops", async () => {
    const res = await post({ op: "confirm-payment", storeId: STORE, orderId: ORDER, methodLabel: "GCash" });
    expect(res.status).toBe(200);
  });

  it("still requires toStatus for a transition", async () => {
    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "storeId, orderId, toStatus required." });
  });

  it("refuses a store the staff is not assigned to", async () => {
    const res = await post({
      op: "confirm-payment",
      storeId: "some_other_store",
      orderId: ORDER,
      methodLabel: "GCash",
    });
    expect(res.status).toBe(403);
  });
});

// The kitchen role is only on this route (requireActiveStaff widened to admit
// it) so the KDS can serve/cancel its own tickets — it must not gain the
// other ops as a side effect of that widening.
describe("op dispatch — kitchen role is scoped to kitchen-ticket-status", () => {
  it("denies a kitchen-role staffer calling transition", async () => {
    mockStaffRole = "kitchen";
    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "accepted" });
    expect(res.status).toBe(403);
  });

  it("denies a kitchen-role staffer calling confirm-payment", async () => {
    mockStaffRole = "kitchen";
    const res = await post({ op: "confirm-payment", storeId: STORE, orderId: ORDER, methodLabel: "GCash" });
    expect(res.status).toBe(403);
  });

  it("denies a kitchen-role staffer calling unconfirm-payment", async () => {
    mockStaffRole = "kitchen";
    const res = await post({ op: "unconfirm-payment", storeId: STORE, orderId: ORDER, reason: "test" });
    expect(res.status).toBe(403);
  });

  it("still allows a cashier through to transition (role gate is kitchen-specific)", async () => {
    mockStaffRole = "cashier";
    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "accepted" });
    expect(res.status).toBe(200);
  });
});

describe("op: kitchen-ticket-status", () => {
  const TICKET_PATH = `stores/${STORE}/onlineOrders/${ORDER}/kitchentickets/k1`;

  function seedTicket(over: Record<string, any> = {}) {
    harness.docs[TICKET_PATH] = {
      id: "k1",
      onlineOrderId: ORDER,
      storeId: STORE,
      status: "preparing",
      itemName: "Unli Samgyup",
      kitchenLocationId: "grill",
      createdAtClientMs: Date.now() - 60_000,
      ...over,
    };
  }

  it("allows a kitchen-role staffer to serve a ticket", async () => {
    mockStaffRole = "kitchen";
    seedTicket();
    const res = await post({ op: "kitchen-ticket-status", storeId: STORE, orderId: ORDER, ticketId: "k1", status: "served" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, status: "served", alreadyFinal: false });
    const update = harness.updates.find((u) => u.path === TICKET_PATH)?.data;
    expect(update).toMatchObject({ status: "served", servedByUid: ACTOR_UID });
  });

  it("removes the ticket from the rtKdsTickets fan-out and archives it", async () => {
    seedTicket();
    await post({ op: "kitchen-ticket-status", storeId: STORE, orderId: ORDER, ticketId: "k1", status: "served" });
    const rtUpdate = harness.updates.find((u) => u.path === `stores/${STORE}/rtKdsTickets/grill`)?.data;
    expect(rtUpdate).toBeTruthy();
    expect(Object.keys(rtUpdate).some((k) => k.includes("k1"))).toBe(true);
    const archived = harness.sets.find((s) => s.path === `stores/${STORE}/rtKdsTickets/grill/closedKdsTickets/k1`);
    expect(archived).toBeTruthy();
  });

  it("requires a reason to cancel a ticket", async () => {
    seedTicket();
    const res = await post({ op: "kitchen-ticket-status", storeId: STORE, orderId: ORDER, ticketId: "k1", status: "cancelled" });
    expect(res.status).toBe(400);
  });

  it("writes cancelReason onto the ticket when a reason is given", async () => {
    seedTicket();
    await post({ op: "kitchen-ticket-status", storeId: STORE, orderId: ORDER, ticketId: "k1", status: "cancelled", reason: "Out of stock" });
    const update = harness.updates.find((u) => u.path === TICKET_PATH)?.data;
    expect(update).toMatchObject({ status: "cancelled", cancelReason: "Out of stock" });
  });

  it("no-ops without error on an already-finalized ticket", async () => {
    seedTicket({ status: "served" });
    const res = await post({ op: "kitchen-ticket-status", storeId: STORE, orderId: ORDER, ticketId: "k1", status: "served" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, alreadyFinal: true });
    expect(harness.updates.find((u) => u.path === TICKET_PATH)).toBeUndefined();
  });

  it("404s when the ticket doesn't exist", async () => {
    const res = await post({ op: "kitchen-ticket-status", storeId: STORE, orderId: ORDER, ticketId: "missing", status: "served" });
    expect(res.status).toBe(404);
  });

  it("400s on an unrecognized status value", async () => {
    seedTicket();
    const res = await post({ op: "kitchen-ticket-status", storeId: STORE, orderId: ORDER, ticketId: "k1", status: "preparing" });
    expect(res.status).toBe(400);
  });
});

// --- transition: accepted creates kitchen tickets ---------------------------

describe("transition: accepted creates kitchen tickets", () => {
  it("creates a ticket + rtKdsTickets fan-out for each mapped line, and reports the counts", async () => {
    seedWithInventory(
      baseOrder({
        status: "pending",
        lines: [
          { lineId: "l1", productId: "p1", name: "Unli Samgyup", category: "Mains", unitPrice: 500, qty: 1 },
          { lineId: "l2", productId: "p2", name: "Iced Tea", category: "Drinks", unitPrice: 40, qty: 2 },
        ],
      }),
      {
        p1: { kitchenLocationId: "grill", kitchenLocationName: "Grill" },
        p2: { kitchenLocationId: "drinks", kitchenLocationName: "Drinks" },
      }
    );

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "accepted" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ticketsCreated).toBe(2);
    expect(json.itemsSkipped).toBe(0);

    const ticketSets = harness.sets.filter((s) => s.path.includes("/kitchentickets/"));
    expect(ticketSets).toHaveLength(2);
    expect(ticketSets.map((s) => s.path).sort()).toEqual([
      `stores/${STORE}/onlineOrders/${ORDER}/kitchentickets/${ORDER}_0`,
      `stores/${STORE}/onlineOrders/${ORDER}/kitchentickets/${ORDER}_1`,
    ]);

    const fanoutSets = harness.sets.filter((s) => s.path.startsWith(`stores/${STORE}/rtKdsTickets/`));
    expect(fanoutSets.map((s) => s.path).sort()).toEqual([
      `stores/${STORE}/rtKdsTickets/drinks`,
      `stores/${STORE}/rtKdsTickets/grill`,
    ]);
  });

  it("still accepts the order and reports itemsSkipped when a line has no kitchen-location mapping", async () => {
    seedWithInventory(
      baseOrder({
        status: "pending",
        lines: [{ lineId: "l1", productId: "p1", name: "Unmapped Item", category: "Mains", unitPrice: 500, qty: 1 }],
      }),
      { p1: {} } // exists, but no kitchenLocationId
    );

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "accepted" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(orderUpdate().status).toBe("accepted");
    expect(json.ticketsCreated).toBe(0);
    expect(json.itemsSkipped).toBe(1);
    expect(harness.sets.filter((s) => s.path.includes("/kitchentickets/"))).toHaveLength(0);
  });

  it("still accepts the order when the inventory doc doesn't exist at all", async () => {
    seedWithInventory(
      baseOrder({
        status: "pending",
        lines: [{ lineId: "l1", productId: "does-not-exist", name: "Ghost Item", category: "Mains", unitPrice: 500, qty: 1 }],
      })
      // no inventory docs seeded at all
    );

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "accepted" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(orderUpdate().status).toBe("accepted");
    expect(json.ticketsCreated).toBe(0);
    expect(json.itemsSkipped).toBe(1);
  });

  it("resolves the kitchen location via variantId, not productId, for a variant line", async () => {
    seedWithInventory(
      baseOrder({
        status: "pending",
        lines: [{ lineId: "l1", productId: "family1", variantId: "spicy_v1", name: "Kimbap (Spicy)", category: "Mains", unitPrice: 200, qty: 1 }],
      }),
      { spicy_v1: { kitchenLocationId: "grill" } }
    );

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "accepted" });
    const json = await res.json();

    expect(json.ticketsCreated).toBe(1);
    const ticketSet = harness.sets.find((s) => s.path.includes("/kitchentickets/"));
    expect(ticketSet!.data.itemId).toBe("spicy_v1");
  });

  it("does not create tickets for a transition other than accepted", async () => {
    seedWithInventory(
      baseOrder({ status: "accepted", lines: [{ lineId: "l1", productId: "p1", name: "Item", category: "Mains", unitPrice: 500, qty: 1 }] }),
      { p1: { kitchenLocationId: "grill" } }
    );

    const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "preparing" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ticketsCreated).toBe(0);
    expect(json.itemsSkipped).toBe(0);
    expect(harness.sets.filter((s) => s.path.includes("/kitchentickets/"))).toHaveLength(0);
  });

  it("still accepts the order when ticket resolution throws on a malformed line", async () => {
    // A null entry in `lines` makes resolveInventoryLookupId throw (it reads
    // `.variantId`/`.productId` off the line) both during the lookup-read step
    // and again during the ticket-build step. The accept must still go through.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      seedWithInventory(baseOrder({ status: "pending", lines: [null] }));

      const res = await post({ op: "transition", storeId: STORE, orderId: ORDER, toStatus: "accepted" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.status).toBe("accepted");
      expect(orderUpdate().status).toBe("accepted");
      expect(json.ticketsCreated).toBe(0);
      expect(json.itemsSkipped).toBe(1);
      expect(harness.sets.filter((s) => s.path.includes("/kitchentickets/"))).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
