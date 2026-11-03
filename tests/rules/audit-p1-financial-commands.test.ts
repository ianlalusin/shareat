import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/**
 * Audit P1 (B01/B16/B17/NOV-RECEIPTS) rules: offline commands are create-only,
 * immutable and unreadable by clients; command results / effects are
 * server-written. See docs/audit/pos-financial-commands.md §4/§7.
 */

const A = "storeA";
const STAFF = {
  admin: { uid: "u_admin", role: "admin", status: "active", assignedStoreIds: [A] },
  manager: { uid: "u_manager", role: "manager", status: "active", assignedStoreIds: [A] },
  cashier: { uid: "u_cashier", role: "cashier", status: "active", assignedStoreIds: [A] },
  server: { uid: "u_server", role: "server", status: "active", assignedStoreIds: [A] },
  kitchen: { uid: "u_kitchen", role: "kitchen", status: "active", assignedStoreIds: [A] },
  other: { uid: "u_other", role: "cashier", status: "active", assignedStoreIds: ["storeB"] },
} as const;
type StaffKey = keyof typeof STAFF;

let testEnv: RulesTestEnvironment;
const db = (who: StaffKey): Firestore =>
  testEnv.authenticatedContext(STAFF[who].uid).firestore() as unknown as Firestore;
const d = (who: StaffKey, path: string) => doc(db(who), path);

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as any, path), data);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-pos",
    firestore: {
      rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});
afterAll(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  for (const s of Object.values(STAFF)) {
    await seed(`staff/${s.uid}`, { role: s.role, status: s.status, assignedStoreIds: s.assignedStoreIds, name: s.uid });
  }
  await seed(`stores/${A}`, { name: "A" });
});

const command = (uid: string, opId = "op1", over: Record<string, unknown> = {}) => ({
  schema: 1, opId, kind: "checkout", storeId: A, sessionId: "s1", terminalId: "dev", createdByUid: uid, resolved: false,
  clientCreatedAtMs: 1, operatorSessionToken: "tok",
  expected: { sessionRevision: 1, billingRevision: 0, tableId: "t1", totalCents: 100 },
  payload: { receiptNumber: "A-OL-X-0000-001", receiptSeq: 1, payments: [{ methodId: "cash", amount: 1 }] },
  ...over,
});

describe("posCommands: create-only, immutable, unreadable (B16)", () => {
  it("a cashier creates their own command", async () => {
    await assertSucceeds(setDoc(d("cashier", `stores/${A}/posCommands/op1`), command(STAFF.cashier.uid)));
  });
  it("cannot create a command in another account's name, for another store, or with a mismatched id", async () => {
    await assertFails(setDoc(d("cashier", `stores/${A}/posCommands/op1`), command(STAFF.manager.uid)));
    await assertFails(setDoc(d("cashier", `stores/${A}/posCommands/op1`), command(STAFF.cashier.uid, "op2")));
    await assertFails(setDoc(d("cashier", `stores/${A}/posCommands/op1`), command(STAFF.cashier.uid, "op1", { storeId: "storeB" })));
    await assertFails(setDoc(d("cashier", `stores/${A}/posCommands/op1`), command(STAFF.cashier.uid, "op1", { kind: "refund" })));
    await assertFails(setDoc(d("other", `stores/${A}/posCommands/op1`), command(STAFF.other.uid)));
  });
  it("is immutable and unreadable once written", async () => {
    await seed(`stores/${A}/posCommands/op1`, command(STAFF.cashier.uid));
    await assertFails(setDoc(d("cashier", `stores/${A}/posCommands/op1`), command(STAFF.cashier.uid)));
    await assertFails(updateDoc(d("cashier", `stores/${A}/posCommands/op1`), { expected: { totalCents: 1 } }));
    await assertFails(deleteDoc(d("manager", `stores/${A}/posCommands/op1`)));
    await assertFails(getDoc(d("manager", `stores/${A}/posCommands/op1`)));
  });
  it("results are readable by store staff and never client-written; effects are server-only", async () => {
    await seed(`stores/${A}/posCommandResults/op1`, { status: "rejected" });
    await seed(`stores/${A}/posEffects/s1__pinFinalize`, { status: "pending", payload: { pin: "123456" } });
    await assertSucceeds(getDoc(d("cashier", `stores/${A}/posCommandResults/op1`)));
    await assertFails(setDoc(d("manager", `stores/${A}/posCommandResults/op1`), { status: "accepted" }));
    await assertFails(getDoc(d("cashier", `stores/${A}/posEffects/s1__pinFinalize`)));
    await assertFails(updateDoc(d("admin", `stores/${A}/posEffects/s1__pinFinalize`), { status: "done" }));
  });
});

// Final P1 tightening (deploy only after every till runs the P1 APK).
describe("canonical money docs cannot be forged by assigned staff (B01 / NOV-RECEIPTS)", () => {
  beforeEach(async () => {
    await seed(`stores/${A}/sessions/s1`, { status: "active", tableId: "t1", revision: 1, billingRevision: 0 });
    await seed(`stores/${A}/receipts/r1`, { status: "final", total: 100, receiptNumber: "A-000001", analyticsApplied: true });
    await seed(`stores/${A}/receipts/r1/revisions/v1`, { version: 1 });
    await seed(`stores/${A}/counters/receipts`, { seq: 1 });
    await seed(`stores/${A}/tables/t1`, { status: "occupied", currentSessionId: "s1" });
  });

  for (const who of ["cashier", "server", "kitchen", "manager", "admin"] as const) {
    it(`${who}: cannot create, rewrite, void or flag receipts, revisions or counters`, async () => {
      const forged = { status: "final", total: 1, totalPaid: 1, receiptNumber: "A-999999", analyticsApplied: true };
      await assertFails(setDoc(d(who, `stores/${A}/receipts/forged`), forged));
      await assertFails(setDoc(d(who, `stores/${A}/receipts/forged_off`), { ...forged, offlineOrigin: true }));
      await assertFails(updateDoc(d(who, `stores/${A}/receipts/r1`), { total: 1 }));
      await assertFails(updateDoc(d(who, `stores/${A}/receipts/r1`), { status: "voided" }));
      await assertFails(updateDoc(d(who, `stores/${A}/receipts/r1`), { analyticsApplied: false }));
      await assertFails(updateDoc(d(who, `stores/${A}/receipts/r1`), { analyticsReversed: true }));
      await assertFails(setDoc(d(who, `stores/${A}/receipts/r1/revisions/v2`), { version: 2, snapshot: forged }));
      await assertFails(updateDoc(d(who, `stores/${A}/receipts/r1/revisions/v1`), { version: 9 }));
      await assertFails(setDoc(d(who, `stores/${A}/counters/receipts`), { seq: 2 }));
      await assertFails(setDoc(d(who, `stores/${A}/paymentConversions/c1`), { amount: 100 }));
      await assertFails(setDoc(d(who, `stores/${A}/sessions/s1/payments/p1`), { methodId: "cash", amount: 100 }));
      await assertFails(updateDoc(d(who, `stores/${A}/sessions/s1`), { status: "closed", isPaid: true }));
      await assertFails(updateDoc(d(who, `stores/${A}/tables/t1`), { status: "available", currentSessionId: null }));
    });
  }

  it("authorized client flows still pass: print audit, offline command, bill edits, seating", async () => {
    await assertSucceeds(updateDoc(d("cashier", `stores/${A}/receipts/r1`), { printedCount: 1, lastPrintedByUid: STAFF.cashier.uid, lastPrintedByUsername: "Ana" }));
    await assertSucceeds(setDoc(d("cashier", `stores/${A}/posCommands/opX`), command(STAFF.cashier.uid, "opX")));
    await assertSucceeds(updateDoc(d("server", `stores/${A}/sessions/s1`), { billingRevision: 1, guestCountServerVerified: 4 }));
    await assertSucceeds(setDoc(d("server", `stores/${A}/sessions/s1/sessionBillLines/b1`), { qtyOrdered: 1 }));
    await assertSucceeds(setDoc(d("cashier", `stores/${A}/sessions/s2`), { status: "pending_verification", isPaid: false, revision: 1 }));
    await assertFails(setDoc(d("cashier", `stores/${A}/sessions/s3`), { status: "closed", isPaid: true }));
    await assertSucceeds(updateDoc(d("cashier", `stores/${A}/tables/t1`), { status: "occupied", currentSessionId: "s2" }));
    await assertSucceeds(getDoc(d("cashier", `stores/${A}/receipts/r1`)));
  });
});

describe("bill-line prices and discounts (B01 follow-up)", () => {
  const LINES = `stores/${A}/sessions/s1/sessionBillLines`;
  beforeEach(async () => {
    await seed(`stores/${A}/sessions/s1`, { status: "active", tableId: "t1", revision: 1, billingRevision: 0 });
    await seed(`${LINES}/addon_coke_60`, { type: "addon", itemId: "coke", itemName: "Coke", unitPrice: 60, qtyOrdered: 2, voidedQty: 0, freeQty: 0 });
    await seed(`${LINES}/package_pk1`, { type: "package", itemId: "pk1", itemName: "Unli", unitPrice: 500, qtyOrdered: 2 });
  });

  for (const who of ["server", "kitchen"] as const) {
    it(`${who}: cannot lower a price, forge an override, discount, free or reduce qty`, async () => {
      const line = `${LINES}/addon_coke_60`;
      await assertFails(updateDoc(d(who, line), { unitPrice: 1 }));
      await assertFails(updateDoc(d(who, line), { modifiersTotal: -50 }));
      await assertFails(updateDoc(d(who, line), { unitPrice: 1, priceOverride: { unitPrice: 1, byUid: STAFF.cashier.uid } }));
      await assertFails(updateDoc(d(who, line), { [`lineAdjustments.a1`]: { kind: "discount", type: "percent", value: 100, qty: 2 } }));
      await assertFails(updateDoc(d(who, line), { freeQty: 2 }));
      await assertFails(updateDoc(d(who, line), { discountValue: 60, discountQty: 2, discountType: "fixed" }));
      await assertFails(updateDoc(d(who, line), { qtyOrdered: 1 }));
      await assertFails(setDoc(d(who, `${LINES}/addon_x_1`), { type: "addon", itemId: "x", unitPrice: 1, qtyOrdered: 1, priceOverride: { unitPrice: 1, byUid: STAFF[who].uid } }));
      await assertFails(setDoc(d(who, `${LINES}/addon_y_1`), { type: "addon", itemId: "y", unitPrice: 50, qtyOrdered: 1, freeQty: 1 }));
      await assertFails(updateDoc(d(who, `stores/${A}/sessions/s1`), { billDiscount: { type: "percent", value: 100 } }));
      await assertFails(deleteDoc(d(who, line)));
    });

    it(`${who}: legitimate flows still pass (add line, add qty, kitchen void, guest count)`, async () => {
      await assertSucceeds(setDoc(d(who, `${LINES}/addon_wings_200`), {
        type: "addon", itemId: "wings", itemName: "Wings", unitPrice: 200, qtyOrdered: 1,
        discountType: null, discountValue: 0, discountQty: 0, freeQty: 0, voidedQty: 0,
      }));
      await assertSucceeds(updateDoc(d(who, `${LINES}/addon_coke_60`), { qtyOrdered: 3 }));
      // Only kitchen accounts void (final review #1).
      const v = updateDoc(d(who, `${LINES}/addon_coke_60`), { voidedQty: 1, kitchenVoidedQty: 1, voidReason: "kitchen_cancel" });
      if (who === "kitchen") await assertSucceeds(v);
      else await assertFails(v);
      await assertSucceeds(updateDoc(d(who, `${LINES}/package_pk1`), { qtyOrdered: 3 }));
      await assertSucceeds(updateDoc(d(who, `stores/${A}/sessions/s1`), { billingRevision: 1, guestCountServerVerified: 3 }));
    });
  }

  it("cashier: price override only in their own uid; discounts and bill discount allowed", async () => {
    const line = `${LINES}/addon_coke_60`;
    await assertSucceeds(updateDoc(d("cashier", line), { unitPrice: 50, priceOverride: { unitPrice: 50, byUid: STAFF.cashier.uid, atMs: 1 } }));
    await assertFails(updateDoc(d("cashier", line), { unitPrice: 40, priceOverride: { unitPrice: 40, byUid: STAFF.manager.uid } }));
    await assertSucceeds(updateDoc(d("cashier", line), { [`lineAdjustments.a1`]: { kind: "discount", type: "percent", value: 10, qty: 1 } }));
    await assertSucceeds(updateDoc(d("cashier", line), { qtyOrdered: 1, note: "after override" }));
    await assertSucceeds(updateDoc(d("cashier", `stores/${A}/sessions/s1`), { billDiscount: { type: "percent", value: 20 }, billingRevision: 2 }));
    await assertSucceeds(updateDoc(d("manager", line), { unitPrice: 45, priceOverride: { unitPrice: 45, byUid: STAFF.manager.uid } }));
  });
});

describe("review fixes (audit P1 review 2026-11-03)", () => {
  const LINES = `stores/${A}/sessions/s1/sessionBillLines`;
  beforeEach(async () => {
    await seed(`stores/${A}/sessions/s1`, { status: "active", tableId: "t1", revision: 1, billingRevision: 0, loyaltyRedemptions: [] });
    await seed(`${LINES}/addon_coke_60`, { type: "addon", itemId: "coke", unitPrice: 60, qtyOrdered: 2, voidedQty: 0 });
  });

  for (const who of ["server", "kitchen", "cashier", "manager"] as const) {
    it(`#1 ${who}: cannot write loyaltyRedemptions or delete a session`, async () => {
      await assertFails(updateDoc(d(who, `stores/${A}/sessions/s1`), { loyaltyRedemptions: [{ redemptionId: "x", type: "percent", value: 100 }] }));
      await assertFails(setDoc(d(who, `stores/${A}/sessions/s9`), { status: "active", loyaltyRedemptions: [{ redemptionId: "x", type: "percent", value: 100 }] }));
      await assertFails(deleteDoc(d(who, `stores/${A}/sessions/s1`)));
      await assertFails(setDoc(d(who, `stores/${A}/sessions/s8`), { status: "active", revision: 7 }));
    });
  }

  it("#1 server/kitchen cannot create a session with a bill discount; cashier can", async () => {
    await assertFails(setDoc(d("server", `stores/${A}/sessions/s7`), { status: "active", billDiscount: { type: "percent", value: 100 } }));
    await assertFails(setDoc(d("kitchen", `stores/${A}/sessions/s7`), { status: "active", customAdjustments: [{ type: "fixed", value: -500 }] }));
    await assertSucceeds(setDoc(d("cashier", `stores/${A}/sessions/s7`), { status: "pending_verification", revision: 1, billDiscount: null }));
  });

  it("#3 server/kitchen voids must move kitchenVoidedQty by the same amount", async () => {
    const line = `${LINES}/addon_coke_60`;
    await assertFails(updateDoc(d("kitchen", line), { voidedQty: 2 }));
    await assertFails(updateDoc(d("server", line), { voidedQty: 2, kitchenVoidedQty: 1 }));
    await assertFails(setDoc(d("kitchen", `${LINES}/addon_new_60`), { type: "addon", itemId: "new", unitPrice: 60, qtyOrdered: 1, voidedQty: 1, kitchenVoidedQty: 1 }));
    await assertSucceeds(updateDoc(d("kitchen", line), { voidedQty: 1, kitchenVoidedQty: 1, voidReason: "kitchen_cancel" }));
    await assertFails(updateDoc(d("kitchen", line), { voidedQty: 0, kitchenVoidedQty: 0 }));
    await assertSucceeds(updateDoc(d("cashier", line), { voidedQty: 2, voidReason: "customer_changed_mind" }));
  });

  it("#7 offline commands must be created unresolved", async () => {
    await assertFails(setDoc(d("cashier", `stores/${A}/posCommands/opR`), command(STAFF.cashier.uid, "opR", { resolved: true })));
    const { resolved: _r, ...noFlag } = command(STAFF.cashier.uid, "opR");
    await assertFails(setDoc(d("cashier", `stores/${A}/posCommands/opR`), noFlag));
    await assertSucceeds(setDoc(d("cashier", `stores/${A}/posCommands/opR`), command(STAFF.cashier.uid, "opR")));
  });

  it("#2 tender consumption records are server-only", async () => {
    await assertFails(setDoc(d("cashier", `stores/${A}/tenderConsumptions/res_r1__p1`), { receiptId: "x" }));
    await assertFails(setDoc(d("manager", `stores/${A}/tenderConsumptions/res_r1__p1`), { receiptId: "x" }));
  });
});

describe("re-review fixes (audit P1 re-review 2026-11-03)", () => {
  const S1 = `stores/${A}/sessions/s1`;
  beforeEach(async () => {
    await seed(S1, { status: "active", tableId: "t1", revision: 1, billingRevision: 0 });
    await seed(`${S1}/sessionBillLines/package_pk1`, { type: "package", itemId: "pk1", unitPrice: 500, qtyOrdered: 4 });
    await seed(`${S1}/kitchentickets/k1`, { status: "preparing", billLineId: "addon_coke_60", qty: 1 });
    await seed(`stores/${A}/reservations/r1`, { name: "Cruz", payments: [] });
  });

  for (const who of ["server", "kitchen"] as const) {
    it(`#2 ${who}: cannot record reservation deposits, clear the applied marker, or link a reservation to a bill`, async () => {
      await assertFails(updateDoc(d(who, `stores/${A}/reservations/r1`), { payments: [{ id: "p9", methodId: "gcash", amount: 500 }] }));
      await assertFails(updateDoc(d(who, `stores/${A}/reservations/r1`), { paymentsAppliedToSessionId: null }));
      await assertFails(setDoc(d(who, `stores/${A}/reservations/r2`), { payments: [{ id: "p1", amount: 500 }] }));
      await assertFails(updateDoc(d(who, S1), { reservationId: "r1" }));
      await assertSucceeds(updateDoc(d(who, `stores/${A}/reservations/r1`), { partySize: 6 }));
    });

    it(`#3 ${who}: cannot create a cancelled ticket or change a ticket's qty / line`, async () => {
      await assertFails(setDoc(d(who, `${S1}/kitchentickets/fake`), { status: "cancelled", billLineId: "addon_coke_60", qty: 99 }));
      await assertFails(updateDoc(d(who, `${S1}/kitchentickets/k1`), { qty: 99 }));
      await assertFails(updateDoc(d(who, `${S1}/kitchentickets/k1`), { billLineId: "other" }));
    });

    it(`D ${who}: cannot lower the package heads`, async () => {
      await assertFails(updateDoc(d(who, `${S1}/sessionBillLines/package_pk1`), { qtyOrdered: 0 }));
      await assertFails(updateDoc(d(who, `${S1}/sessionBillLines/package_pk1`), { qtyOrdered: 3 }));
      await assertSucceeds(updateDoc(d(who, `${S1}/sessionBillLines/package_pk1`), { qtyOrdered: 5 }));
    });

    it(`A ${who}: cannot record an offline command`, async () => {
      await assertFails(setDoc(d(who, `stores/${A}/posCommands/opS`), command(STAFF[who].uid, "opS")));
    });
  }

  it("cashier: may record deposits, link reservations, lower heads; malformed commands refused", async () => {
    await assertSucceeds(updateDoc(d("cashier", `stores/${A}/reservations/r1`), { payments: [{ id: "p1", methodId: "gcash", amount: 500 }] }));
    await assertSucceeds(updateDoc(d("cashier", S1), { reservationId: "r1" }));
    await assertSucceeds(updateDoc(d("cashier", `${S1}/sessionBillLines/package_pk1`), { qtyOrdered: 3 }));
    await assertFails(setDoc(d("cashier", `stores/${A}/posCommands/opM`), { ...command(STAFF.cashier.uid, "opM"), extra: true }));
    await assertFails(setDoc(d("cashier", `stores/${A}/posCommands/opM`), { ...command(STAFF.cashier.uid, "opM"), clientCreatedAtMs: "soon" }));
    await assertFails(setDoc(d("cashier", `stores/${A}/posCommands/opM`), { ...command(STAFF.cashier.uid, "opM"), expected: "x" }));
    await assertSucceeds(setDoc(d("cashier", `stores/${A}/posCommands/opM`), command(STAFF.cashier.uid, "opM")));
  });
});

describe("final-state review fixes (audit P1, 2026-11-03)", () => {
  const S1 = `stores/${A}/sessions/s1`;
  const L = `${S1}/sessionBillLines`;
  beforeEach(async () => {
    await seed(S1, { status: "active", tableId: "t1", revision: 1, billingRevision: 0 });
    await seed(`${L}/addon_coke_60`, { type: "addon", itemId: "coke", unitPrice: 60, qtyOrdered: 2, voidedQty: 0 });
    await seed(`${L}/package_pk1`, { type: "package", itemId: "pk1", unitPrice: 500, qtyOrdered: 4, voidedQty: 0 });
    await seed(`${S1}/kitchentickets/k1`, { status: "preparing", billLineId: "addon_coke_60", qty: 2 });
    await seed(`${S1}/kitchentickets/ks`, { status: "served", billLineId: "addon_coke_60", qty: 1, qtyServed: 1 });
    await seed(`stores/${A}/receipts/r1`, { status: "final", printedCount: 0 });
  });

  it("separation of duties: server creates tickets but cannot cancel; kitchen cancels but cannot create", async () => {
    await assertSucceeds(setDoc(d("server", `${S1}/kitchentickets/k2`), { status: "preparing", billLineId: "addon_coke_60", qty: 1 }));
    await assertFails(setDoc(d("kitchen", `${S1}/kitchentickets/k3`), { status: "preparing", billLineId: "addon_coke_60", qty: 1 }));
    await assertFails(updateDoc(d("server", `${S1}/kitchentickets/k1`), { status: "cancelled" }));
    await assertFails(updateDoc(d("server", `${S1}/kitchentickets/k1`), { qtyCancelled: 2 }));
    await assertSucceeds(updateDoc(d("kitchen", `${S1}/kitchentickets/k1`), { status: "cancelled", qtyCancelled: 2, qtyRemaining: 0 }));
  });

  it("served tickets are final; cancelled + served never exceeds the ticket quantity", async () => {
    await assertFails(updateDoc(d("kitchen", `${S1}/kitchentickets/ks`), { status: "cancelled", qtyCancelled: 1 }));
    await assertFails(updateDoc(d("kitchen", `${S1}/kitchentickets/k1`), { status: "served", qtyServed: 1, qtyCancelled: 5 }));
    await assertSucceeds(updateDoc(d("kitchen", `${S1}/kitchentickets/k1`), { status: "served", qtyServed: 1, qtyCancelled: 1 }));
  });

  it("only kitchen voids, only on add-on lines; line id is immutable", async () => {
    await assertFails(updateDoc(d("server", `${L}/addon_coke_60`), { voidedQty: 1, kitchenVoidedQty: 1 }));
    await assertFails(updateDoc(d("kitchen", `${L}/package_pk1`), { voidedQty: 2, kitchenVoidedQty: 2 }));
    await assertSucceeds(updateDoc(d("kitchen", `${L}/addon_coke_60`), { voidedQty: 1, kitchenVoidedQty: 1, voidReason: "kitchen_cancel" }));
    await assertFails(updateDoc(d("server", `${L}/addon_coke_60`), { id: "other" }));
  });

  it("print audit must name the signed-in account", async () => {
    await assertFails(updateDoc(d("cashier", `stores/${A}/receipts/r1`), { printedCount: 1, lastPrintedByUid: STAFF.manager.uid }));
    await assertSucceeds(updateDoc(d("cashier", `stores/${A}/receipts/r1`), { printedCount: 1, lastPrintedByUid: STAFF.cashier.uid, lastPrintedByUsername: "Ana" }));
  });
});
