import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/**
 * Audit 2026-10-29 regressions.
 *
 * B06: the two root read fallbacks handed every active staffer every
 * loyaltyRedemptions voucher and every store's pinRegistry entries, ORing
 * past those collections' own (stricter) blocks.
 * B20: serverProfiles sat in the store catch-all's write grant, so any shift
 * role could rename/delete a colleague's profile or plant a legacy
 * passcodeHash. All writes now go through /api/server-profiles.
 */

const STORE_A = "storeA";
const STORE_B = "storeB";

const STAFF = {
  admin: { uid: "u_admin", role: "admin", status: "active", assignedStoreIds: [STORE_A] },
  manager: { uid: "u_manager", role: "manager", status: "active", assignedStoreIds: [STORE_A] },
  cashier: { uid: "u_cashier", role: "cashier", status: "active", assignedStoreIds: [STORE_A] },
  server: { uid: "u_server", role: "server", status: "active", assignedStoreIds: [STORE_A] },
  kitchen: { uid: "u_kitchen", role: "kitchen", status: "active", assignedStoreIds: [STORE_A] },
} as const;
type StaffKey = keyof typeof STAFF;

let testEnv: RulesTestEnvironment;

function db(who: StaffKey): Firestore {
  return testEnv.authenticatedContext(STAFF[who].uid).firestore() as unknown as Firestore;
}

function customerDb(storeId: string, sessionId: string): Firestore {
  return testEnv
    .authenticatedContext(`cust_${storeId}_${sessionId}`, { customer: true, storeId, sessionId })
    .firestore() as unknown as Firestore;
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

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const raw = ctx.firestore() as any;
    for (const s of Object.values(STAFF)) {
      await setDoc(doc(raw, "staff", s.uid), {
        role: s.role,
        status: s.status,
        assignedStoreIds: s.assignedStoreIds,
      });
    }
    const future = 9_999_999_999_999;
    await setDoc(doc(raw, "pinRegistry", "1111"), { storeId: STORE_A, sessionId: "s1", status: "active", expiresAtMs: future });
    await setDoc(doc(raw, "pinRegistry", "2222"), { storeId: STORE_B, sessionId: "s9", status: "active", expiresAtMs: future });
    await setDoc(doc(raw, "loyaltyRedemptions", "v1"), { code: "ABC123", phone: "09171234567", storeId: STORE_A });
    await setDoc(doc(raw, "loyaltyRedemptions", "v1", "events", "e1"), { kind: "created" });
    await setDoc(doc(raw, "stores", STORE_A, "serverProfiles", "p1"), { id: "p1", name: "Ana" });
  });
});

describe("B06: loyaltyRedemptions is unreachable through the root fallbacks", () => {
  for (const who of ["cashier", "manager", "admin"] as const) {
    it(`denies ${who} getting a voucher`, async () => {
      await assertFails(getDoc(doc(db(who), "loyaltyRedemptions", "v1")));
    });
    it(`denies ${who} listing vouchers`, async () => {
      await assertFails(getDocs(collection(db(who), "loyaltyRedemptions")));
    });
  }

  it("denies a cashier reading a voucher subcollection doc (recursive fallback)", async () => {
    await assertFails(getDoc(doc(db("cashier"), "loyaltyRedemptions", "v1", "events", "e1")));
  });
});

describe("B06: staff docs are no longer readable by every staffer", () => {
  it("denies a cashier getting a colleague's staff doc", async () => {
    await assertFails(getDoc(doc(db("cashier"), "staff", STAFF.manager.uid)));
  });

  it("denies a cashier listing staff", async () => {
    await assertFails(getDocs(collection(db("cashier"), "staff")));
  });

  it("still lets a cashier get their own staff doc", async () => {
    await assertSucceeds(getDoc(doc(db("cashier"), "staff", STAFF.cashier.uid)));
  });

  it("still lets an admin get any staff doc", async () => {
    await assertSucceeds(getDoc(doc(db("admin"), "staff", STAFF.kitchen.uid)));
  });
});

describe("B06: pinRegistry stays store-scoped", () => {
  it("denies a store-A cashier getting a store-B PIN", async () => {
    await assertFails(getDoc(doc(db("cashier"), "pinRegistry", "2222")));
  });

  it("denies a store-A cashier listing every PIN", async () => {
    await assertFails(getDocs(collection(db("cashier"), "pinRegistry")));
  });

  it("still lets a store-A cashier get a store-A PIN", async () => {
    await assertSucceeds(getDoc(doc(db("cashier"), "pinRegistry", "1111")));
  });

  it("still lets a store-A cashier list store-A PINs with a storeId filter", async () => {
    await assertSucceeds(
      getDocs(query(collection(db("cashier"), "pinRegistry"), where("storeId", "==", STORE_A)))
    );
  });

  it("still lets an admin get any store's PIN", async () => {
    await assertSucceeds(getDoc(doc(db("admin"), "pinRegistry", "2222")));
  });

  it("still lets a customer get an active PIN", async () => {
    await assertSucceeds(getDoc(doc(customerDb(STORE_A, "s1"), "pinRegistry", "1111")));
  });
});

describe("B20: serverProfiles is client-read-only", () => {
  for (const who of ["cashier", "server", "kitchen", "manager", "admin"] as const) {
    it(`still lets ${who} read the roster`, async () => {
      await assertSucceeds(getDocs(collection(db(who), "stores", STORE_A, "serverProfiles")));
    });

    it(`denies ${who} creating a profile directly`, async () => {
      await assertFails(
        setDoc(doc(db(who), "stores", STORE_A, "serverProfiles", "forged"), { id: "forged", name: "Forged" })
      );
    });

    it(`denies ${who} renaming a profile directly`, async () => {
      await assertFails(updateDoc(doc(db(who), "stores", STORE_A, "serverProfiles", "p1"), { name: "Mallory" }));
    });

    it(`denies ${who} planting a legacy passcodeHash`, async () => {
      await assertFails(
        updateDoc(doc(db(who), "stores", STORE_A, "serverProfiles", "p1"), { passcodeHash: "chosen" })
      );
    });

    it(`denies ${who} deleting a profile directly`, async () => {
      await assertFails(deleteDoc(doc(db(who), "stores", STORE_A, "serverProfiles", "p1")));
    });
  }
});
