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
