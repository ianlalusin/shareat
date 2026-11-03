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
  schema: 1, opId, kind: "checkout", storeId: A, sessionId: "s1", terminalId: "dev", createdByUid: uid,
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
      await assertSucceeds(updateDoc(d(who, `${LINES}/addon_coke_60`), { voidedQty: 1, voidReason: "kitchen_cancel" }));
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
