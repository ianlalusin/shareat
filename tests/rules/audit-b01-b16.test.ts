import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Audit 2026-10-29 regressions.
 *
 * B16: offline sale/void batches built from a stale cache could overwrite an
 * online receipt, re-close a settled session, or clear a re-seated table. The
 * session/table/receipt writes they carry are now compare-and-swap in rules.
 * B01 (first slice): receipts cannot be deleted, counters/receipts cannot be
 * rewound, activity logs are append-only.
 *
 * Every "online path" case below mirrors the real writes of
 * completePaymentFromUnits / voidSession / offline payment, so a rule that
 * would break checkout fails here.
 */

const A = "storeA";
const STAFF = {
  admin: { uid: "u_admin", role: "admin", status: "active", assignedStoreIds: [A] },
  manager: { uid: "u_manager", role: "manager", status: "active", assignedStoreIds: [A] },
  cashier: { uid: "u_cashier", role: "cashier", status: "active", assignedStoreIds: [A] },
  server: { uid: "u_server", role: "server", status: "active", assignedStoreIds: [A] },
} as const;
type StaffKey = keyof typeof STAFF;

let testEnv: RulesTestEnvironment;
const db = (who: StaffKey): Firestore =>
  testEnv.authenticatedContext(STAFF[who].uid).firestore() as unknown as Firestore;

async function seed(path: string[], data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as any, path.join("/")), data);
  });
}
async function readRaw(path: string[]) {
  let out: any = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const s = await getDoc(doc(ctx.firestore() as any, path.join("/")));
    out = s.exists() ? s.data() : null;
  });
  return out;
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
    await seed(["staff", s.uid], { role: s.role, status: s.status, assignedStoreIds: s.assignedStoreIds, name: s.uid });
  }
  await seed(["stores", A], { name: "A" });
  await seed(["stores", A, "sessions", "s1"], { status: "active", tableId: "t1", revision: 1 });
  await seed(["stores", A, "activeSessions", "s1"], { status: "active", tableId: "t1" });
  await seed(["stores", A, "tables", "t1"], { status: "occupied", currentSessionId: "s1" });
  await seed(["stores", A, "storeConfig", "current", "tables", "t1"], { status: "occupied", currentSessionId: "s1" });
  await seed(["stores", A, "counters", "receipts"], { seq: 5 });
});

/** The writes completePaymentOffline commits, as one atomic batch. */
function offlineSaleBatch(f: Firestore, opts: { revision: number; writeId: string; receiptNumber: string }) {
  const b = writeBatch(f);
  b.set(doc(f, "stores", A, "sessions", "s1", "payments", `p_${opts.writeId}`), { methodId: "cash", amount: 100 });
  b.update(doc(f, "stores", A, "sessions", "s1"), {
    status: "closed", isPaid: true, revision: opts.revision, offlineWriteId: opts.writeId,
  });
  b.set(doc(f, "stores", A, "closedSessions", "s1"), { status: "closed" });
  b.set(doc(f, "stores", A, "receipts", "s1"), {
    status: "final", offlineOrigin: true, receiptNumber: opts.receiptNumber, total: 100,
  });
  b.update(doc(f, "stores", A, "tables", "t1"), {
    status: "available", currentSessionId: null, closedSessionId: "s1", releasedByWriteId: opts.writeId,
  });
  b.update(doc(f, "stores", A, "storeConfig", "current", "tables", "t1"), {
    status: "available", currentSessionId: null, closedSessionId: "s1", releasedByWriteId: opts.writeId,
  });
  return b;
}

describe("B16 offline sale compare-and-swap", () => {
  it("accepts an offline sale on a still-open session (revision +1)", async () => {
    await seed(["stores", A, "activeSessions", "s1"], { status: "active" });
    const f = db("cashier");
    const b = offlineSaleBatch(f, { revision: 2, writeId: "w1", receiptNumber: "OL-A-1" });
    b.delete(doc(f, "stores", A, "activeSessions", "s1"));
    await assertSucceeds(b.commit());
  });

  it("accepts an offline sale on a legacy session with no revision field", async () => {
    await seed(["stores", A, "sessions", "s1"], { status: "active", tableId: "t1" });
    await assertSucceeds(offlineSaleBatch(db("cashier"), { revision: 2, writeId: "w1", receiptNumber: "OL-A-1" }).commit());
  });

  it("rejects the WHOLE stale batch when the session was settled online — online receipt and table survive", async () => {
    await seed(["stores", A, "sessions", "s1"], { status: "closed", isPaid: true, tableId: "t1", revision: 1 });
    await seed(["stores", A, "receipts", "s1"], { status: "final", receiptNumber: "SELIP-000006", total: 100 });
    await seed(["stores", A, "tables", "t1"], { status: "occupied", currentSessionId: "s2" });
    await assertFails(offlineSaleBatch(db("cashier"), { revision: 2, writeId: "w1", receiptNumber: "OL-A-1" }).commit());
    expect((await readRaw(["stores", A, "receipts", "s1"])).receiptNumber).toBe("SELIP-000006");
    expect((await readRaw(["stores", A, "tables", "t1"])).currentSessionId).toBe("s2");
  });

  it("rejects a second terminal's offline sale of the same session", async () => {
    await assertSucceeds(offlineSaleBatch(db("cashier"), { revision: 2, writeId: "w1", receiptNumber: "OL-A-1" }).commit());
    await assertFails(offlineSaleBatch(db("manager"), { revision: 2, writeId: "w2", receiptNumber: "OL-B-1" }).commit());
    expect((await readRaw(["stores", A, "receipts", "s1"])).receiptNumber).toBe("OL-A-1");
  });

  it("rejects a revision that skips ahead", async () => {
    await assertFails(updateDoc(doc(db("cashier"), "stores", A, "sessions", "s1"), {
      status: "closed", revision: 3, offlineWriteId: "w1",
    }));
  });

  it("rejects an offline void of a session already paid", async () => {
    await seed(["stores", A, "sessions", "s1"], { status: "closed", isPaid: true, revision: 1 });
    await assertFails(updateDoc(doc(db("cashier"), "stores", A, "sessions", "s1"), {
      status: "voided", revision: 2, offlineWriteId: "w9", offlineOrigin: true,
    }));
  });

  it("rejects an offline release of a table re-seated by another session", async () => {
    await seed(["stores", A, "tables", "t1"], { status: "occupied", currentSessionId: "s2" });
    await assertFails(updateDoc(doc(db("cashier"), "stores", A, "tables", "t1"), {
      currentSessionId: null, closedSessionId: "s1", releasedByWriteId: "w1",
    }));
    await seed(["stores", A, "storeConfig", "current", "tables", "t1"], { currentSessionId: "s2" });
    await assertFails(updateDoc(doc(db("cashier"), "stores", A, "storeConfig", "current", "tables", "t1"), {
      currentSessionId: null, closedSessionId: "s1", releasedByWriteId: "w1",
    }));
  });

  it("does not block later ordinary table writes after an offline release (incl. full overwrite)", async () => {
    await assertSucceeds(offlineSaleBatch(db("cashier"), { revision: 2, writeId: "w1", receiptNumber: "OL-A-1" }).commit());
    await assertSucceeds(updateDoc(doc(db("cashier"), "stores", A, "tables", "t1"), { status: "occupied", currentSessionId: "s2" }));
    await assertSucceeds(setDoc(doc(db("manager"), "stores", A, "tables", "t1"), { status: "available", name: "T1" }));
    await assertSucceeds(deleteDoc(doc(db("manager"), "stores", A, "tables", "t1")));
  });

  it("rejects an offline receipt overwriting an online one, or another offline number", async () => {
    await seed(["stores", A, "receipts", "r1"], { status: "final", receiptNumber: "SELIP-1" });
    await assertFails(setDoc(doc(db("cashier"), "stores", A, "receipts", "r1"), { status: "final", offlineOrigin: true, receiptNumber: "OL-A-1" }));
    await seed(["stores", A, "receipts", "r2"], { status: "final", offlineOrigin: true, receiptNumber: "OL-A-1" });
    await assertFails(setDoc(doc(db("cashier"), "stores", A, "receipts", "r2"), { status: "final", offlineOrigin: true, receiptNumber: "OL-B-1" }));
    await assertSucceeds(setDoc(doc(db("cashier"), "stores", A, "receipts", "r2"), { status: "final", offlineOrigin: true, receiptNumber: "OL-A-1" }));
    // later edits/print stamps of an offline receipt keep working
    await assertSucceeds(updateDoc(doc(db("cashier"), "stores", A, "receipts", "r2"), { printCount: 1, isEdited: true }));
  });
});

describe("online checkout / void paths still pass (no CAS fields written)", () => {
  it("allows the completePaymentFromUnits write set", async () => {
    const f = db("cashier");
    const b = writeBatch(f);
    b.set(doc(f, "stores", A, "sessions", "s1", "payments", "p1"), { methodId: "cash", amount: 100 });
    b.update(doc(f, "stores", A, "sessions", "s1"), { status: "closed", isPaid: true, closedByUid: "u_cashier" });
    b.set(doc(f, "stores", A, "closedSessions", "s1"), { status: "closed" });
    b.delete(doc(f, "stores", A, "activeSessions", "s1"));
    b.set(doc(f, "stores", A, "counters", "receipts"), { seq: 6 }, { merge: true });
    b.set(doc(f, "stores", A, "receipts", "s1"), { status: "final", receiptNumber: "SELIP-000006", total: 100, analyticsApplied: false });
    b.update(doc(f, "stores", A, "tables", "t1"), { status: "available", currentSessionId: null });
    b.update(doc(f, "stores", A, "storeConfig", "current", "tables", "t1"), { status: "available", currentSessionId: null });
    await assertSucceeds(b.commit());
    // analytics flag + print stamp afterwards
    await assertSucceeds(updateDoc(doc(f, "stores", A, "receipts", "s1"), { analyticsApplied: true }));
    // receipt void (status flip) + refund receipt + edit revision
    await assertSucceeds(updateDoc(doc(f, "stores", A, "receipts", "s1"), { status: "voided", voidReason: "x" }));
    await assertSucceeds(setDoc(doc(f, "stores", A, "receipts", "s1_refund_1"), { status: "final", isRefund: true }));
    await assertSucceeds(setDoc(doc(f, "stores", A, "receipts", "s1", "revisions", "v1"), { version: 1 }));
    // a later ordinary update to the closed session
    await assertSucceeds(updateDoc(doc(f, "stores", A, "sessions", "s1"), { note: "after close" }));
  });

  it("allows the online voidSession write set", async () => {
    const f = db("cashier");
    const b = writeBatch(f);
    b.update(doc(f, "stores", A, "sessions", "s1"), { status: "voided", voidReason: "test" });
    b.set(doc(f, "stores", A, "closedSessions", "s1"), { status: "voided" });
    b.delete(doc(f, "stores", A, "activeSessions", "s1"));
    b.update(doc(f, "stores", A, "tables", "t1"), { status: "available", currentSessionId: null });
    await assertSucceeds(b.commit());
  });

  it("allows creating the receipt counter when it does not exist yet", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore() as any, "stores", A, "counters", "receipts"));
    });
    await assertSucceeds(setDoc(doc(db("cashier"), "stores", A, "counters", "receipts"), { seq: 1 }, { merge: true }));
  });
});

describe("B01 slice: receipts, counters, activity logs", () => {
  beforeEach(async () => {
    await seed(["stores", A, "receipts", "r1"], { status: "final", total: 100 });
    await seed(["stores", A, "receipts", "r1", "revisions", "v1"], { version: 1 });
    await seed(["stores", A, "activityLogs", "l1"], { action: "SESSION_VOIDED" });
    await seed(["stores", A, "activityLogsByDay", "2026-10-29", "logs", "l1"], { action: "SESSION_VOIDED" });
    await seed(["stores", A, "sessions", "s1", "activityLogs", "l1"], { action: "SESSION_VOIDED" });
  });

  for (const who of ["cashier", "server", "manager", "admin"] as const) {
    it(`denies ${who} deleting a receipt or its revision history`, async () => {
      await assertFails(deleteDoc(doc(db(who), "stores", A, "receipts", "r1")));
      await assertFails(deleteDoc(doc(db(who), "stores", A, "receipts", "r1", "revisions", "v1")));
    });

    it(`denies ${who} editing or erasing an activity log, but allows appending`, async () => {
      const paths: string[][] = [
        ["stores", A, "activityLogs", "l1"],
        ["stores", A, "activityLogsByDay", "2026-10-29", "logs", "l1"],
        ["stores", A, "sessions", "s1", "activityLogs", "l1"],
      ];
      for (const p of paths) {
        await assertFails(updateDoc(doc(db(who), p.join("/")), { action: "NOTHING" }));
        await assertFails(deleteDoc(doc(db(who), p.join("/"))));
        await assertSucceeds(setDoc(doc(db(who), [...p.slice(0, -1), `new_${who}`].join("/")), { action: "X" }));
      }
    });
  }

  it("still allows updating/deleting other session subcollections", async () => {
    await seed(["stores", A, "sessions", "s1", "sessionBillLines", "b1"], { qtyOrdered: 1 });
    await assertSucceeds(updateDoc(doc(db("cashier"), "stores", A, "sessions", "s1", "sessionBillLines", "b1"), { qtyOrdered: 2 }));
    await assertSucceeds(deleteDoc(doc(db("cashier"), "stores", A, "sessions", "s1", "sessionBillLines", "b1")));
  });

  it("denies rewinding or deleting the receipt counter", async () => {
    await assertFails(setDoc(doc(db("cashier"), "stores", A, "counters", "receipts"), { seq: 3 }, { merge: true }));
    await assertFails(setDoc(doc(db("cashier"), "stores", A, "counters", "receipts"), { seq: 9 }, { merge: true }));
    await assertFails(deleteDoc(doc(db("admin"), "stores", A, "counters", "receipts")));
  });

  it("denies another store's staff writing receipts", async () => {
    await seed(["staff", "u_b"], { role: "manager", status: "active", assignedStoreIds: ["storeB"], name: "b" });
    const f = testEnv.authenticatedContext("u_b").firestore() as unknown as Firestore;
    await assertFails(setDoc(doc(f, "stores", A, "receipts", "x"), { status: "final" }));
  });
});
