import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Security-rules tests for the store-scoped write model.
 *
 * The load-bearing assertions are the *open* ones: a wrongly-locked collection
 * shows up in production as a permission-denied on the cashier's critical path,
 * and the offline queue swallows it (commitLocalFirst does not await the
 * commit), so it becomes silent data loss rather than a visible error.
 */

const STORE_A = "storeA";
const STORE_B = "storeB";

/** Locked to manager+admin — mirrors isConfigCollection() in firestore.rules. */
const CONFIG_COLLECTIONS = [
  "inventory",
  "storeDiscounts",
  "storeCharges",
  "storeModesOfPayment",
  "storePackages",
  "storeRefills",
  "storeFlavors",
  "menuSchedules",
  "kitchenLocations",
  "receiptSettings",
  "salesTargets",
  "optionOverrides",
  // QR wallet. Any staffer may DISPLAY a saved QR, but adding or editing one
  // changes which account receives money.
  "savedQrCodes",
  // The denormalized checkout cache (discounts/charges/modesOfPayment/packages) —
  // was missing from this list, which let any store-scoped staffer setDoc a forged
  // 100%-off discount straight into storeConfig/current and apply it at the
  // register. See docs/superpowers/plans/2026-08-12-admin-manager-security-audit.md.
  // The nested storeConfig/current/tables/{t} live-table cache stays operational —
  // see the dedicated test below and the carve-out match block in firestore.rules.
  "storeConfig",
] as const;

/** Written by cashier/server/kitchen during a normal shift — must stay open. */
const OPEN_COLLECTIONS = [
  "sessions",
  "receipts",
  "counters",
  "tables",
  "rtKdsTickets",
  "activeSessions",
  "closedSessions",
  "waitlist",
  "reservations",
  "cashHandovers",
  "chatThreads",
  "customerRequests",
  "serverProfiles",
  "activityLogsByDay",
  "weatherRecords",
  "dailyContext",
  "sessionAuditFlags",
  // Payment-proof photos of the customer's e-wallet confirmation screen. The
  // cashier writes these mid-checkout, so they MUST stay open — see the header.
  "paymentProofs",
  // Audit trail written when a saved QR is displayed to a customer. Also a
  // cashier action, and best-effort: it must never block showing the QR.
  "qrWalletEvents",
] as const;

/** Server-only (Admin SDK writes these; clients never may). */
const SERVER_ONLY_COLLECTIONS = [
  "analytics",
  "analyticsMonths",
  "analyticsYears",
  "dashPresets",
  "dailySessions",
  "storefrontCatalog",
  "storefrontConfig",
  "onlineOrders",
  "paymentIntents",
] as const;

const STAFF = {
  admin: { uid: "u_admin", role: "admin", status: "active", assignedStoreIds: [STORE_A] },
  disabledAdmin: { uid: "u_admin_off", role: "admin", status: "disabled", assignedStoreIds: [STORE_A] },
  manager: { uid: "u_manager", role: "manager", status: "active", assignedStoreIds: [STORE_A] },
  managerB: { uid: "u_manager_b", role: "manager", status: "active", assignedStoreIds: [STORE_B] },
  cashier: { uid: "u_cashier", role: "cashier", status: "active", assignedStoreIds: [STORE_A] },
  server: { uid: "u_server", role: "server", status: "active", assignedStoreIds: [STORE_A] },
  kitchen: { uid: "u_kitchen", role: "kitchen", status: "active", assignedStoreIds: [STORE_A] },
} as const;

type StaffKey = keyof typeof STAFF;

let testEnv: RulesTestEnvironment;

function db(who: StaffKey): Firestore {
  return testEnv.authenticatedContext(STAFF[who].uid).firestore() as unknown as Firestore;
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
    const raw = ctx.firestore();
    for (const s of Object.values(STAFF)) {
      await setDoc(doc(raw as any, "staff", s.uid), {
        role: s.role,
        status: s.status,
        assignedStoreIds: s.assignedStoreIds,
        name: s.uid,
      });
    }
    // Seed docs for the read/update assertions.
    await setDoc(doc(raw as any, "stores", STORE_A), { name: "Store A" });
    await setDoc(doc(raw as any, "stores", STORE_B), { name: "Store B" });
    await setDoc(doc(raw as any, "stores", STORE_A, "receipts", "r1"), { total: 100 });
    await setDoc(doc(raw as any, "stores", STORE_B, "receipts", "r1"), { total: 200 });
    await setDoc(doc(raw as any, "stores", STORE_A, "activeSessions", "s1"), {
      tableId: "t1",
      customerPin: "1234",
      customerAccessEnabled: true,
      customerAccessExpiresAtMs: 9_999_999_999_999,
    });
    await setDoc(
      doc(raw as any, "stores", STORE_A, "sessions", "s1", "kitchentickets", "k1"),
      { storeId: STORE_A, status: "preparing" }
    );
    await setDoc(
      doc(raw as any, "stores", STORE_B, "sessions", "s9", "kitchentickets", "k9"),
      { storeId: STORE_B, status: "preparing" }
    );
    await setDoc(
      doc(raw as any, "stores", STORE_A, "onlineOrders", "o1", "kitchentickets", "k1"),
      { storeId: STORE_A, onlineOrderId: "o1", status: "preparing" }
    );
    await setDoc(doc(raw as any, "stores", STORE_A, "serverProfiles", "p1"), { name: "Ana" });
    await setDoc(doc(raw as any, "stores", STORE_A, "serverProfileSecrets", "sec1"), {
      profileId: "p1",
      algo: "scrypt",
      hash: "deadbeef",
      salt: "abc123",
    });
  });
});

describe("§1 config collections are manager+admin only", () => {
  for (const coll of CONFIG_COLLECTIONS) {
    for (const who of ["cashier", "server", "kitchen"] as const) {
      it(`denies ${who} writing ${coll}`, async () => {
        await assertFails(setDoc(doc(db(who), "stores", STORE_A, coll, "x"), { v: 1 }));
      });
    }
    for (const who of ["manager", "admin"] as const) {
      it(`allows ${who} writing ${coll}`, async () => {
        await assertSucceeds(setDoc(doc(db(who), "stores", STORE_A, coll, "x"), { v: 1 }));
      });
    }
  }
});

describe("§1 operational collections stay open to the shift roles", () => {
  for (const coll of OPEN_COLLECTIONS) {
    for (const who of ["cashier", "server", "kitchen"] as const) {
      it(`allows ${who} writing ${coll}`, async () => {
        await assertSucceeds(setDoc(doc(db(who), "stores", STORE_A, coll, "x"), { v: 1 }));
      });
    }
  }

  it("allows a cashier to write nested receipts/{id}/revisions/{v}", async () => {
    await assertSucceeds(
      setDoc(doc(db("cashier"), "stores", STORE_A, "receipts", "r1", "revisions", "v1"), { n: 1 })
    );
  });

  it("allows a cashier to write nested storeConfig/current/tables/{t}", async () => {
    await assertSucceeds(
      setDoc(doc(db("cashier"), "stores", STORE_A, "storeConfig", "current", "tables", "t1"), {
        status: "occupied",
      })
    );
  });

  it("denies a cashier forging a discount straight into storeConfig/current", async () => {
    await assertFails(
      setDoc(doc(db("cashier"), "stores", STORE_A, "storeConfig", "current"), {
        discounts: [{ id: "forged", name: "forged", type: "percent", value: 100, isEnabled: true }],
      })
    );
  });

  it("allows a manager to rebuild storeConfig/current", async () => {
    await assertSucceeds(
      setDoc(doc(db("manager"), "stores", STORE_A, "storeConfig", "current"), {
        discounts: [],
      })
    );
  });

  it("allows a cashier to write the receipt-number counter", async () => {
    await assertSucceeds(
      setDoc(doc(db("cashier"), "stores", STORE_A, "counters", "receipts"), { seq: 5 })
    );
  });
});

describe("§1 nested config paths inherit the lock", () => {
  it("denies a cashier writing under inventory/{id}/anything", async () => {
    await assertFails(
      setDoc(doc(db("cashier"), "stores", STORE_A, "inventory", "p1", "history", "h1"), { v: 1 })
    );
  });
});

describe("server-only collections are closed to every client", () => {
  for (const coll of SERVER_ONLY_COLLECTIONS) {
    for (const who of ["cashier", "manager", "admin"] as const) {
      it(`denies ${who} writing ${coll}`, async () => {
        await assertFails(setDoc(doc(db(who), "stores", STORE_A, coll, "x"), { v: 1 }));
      });
    }
  }

  // Regression test for C2: the KDS serve/cancel write for an online-order
  // ticket must go through the server (see /api/admin/online-orders'
  // "kitchen-ticket-status" op), never the client SDK — onlineOrders and its
  // subcollections stay write-denied even for the kitchen role that operates
  // the KDS screen.
  it("denies the kitchen role writing an online order's kitchen ticket directly", async () => {
    await assertFails(
      setDoc(doc(db("kitchen"), "stores", STORE_A, "onlineOrders", "o1", "kitchentickets", "k1"), { status: "served" })
    );
  });
});

/**
 * serverProfileSecrets holds hashed 6-digit passcodes for local device
 * profiles. A readable hash is a sub-second offline crack, which would let
 * anyone act on a shared tablet under a colleague's name — so unlike every
 * other store-scoped collection, READ is denied too, for admins included.
 * Only /api/server-profiles touches it, via the Admin SDK.
 */
describe("serverProfileSecrets is server-only, read included", () => {
  for (const who of ["cashier", "server", "kitchen", "manager", "admin"] as const) {
    it(`denies ${who} reading a secret`, async () => {
      await assertFails(
        getDoc(doc(db(who), "stores", STORE_A, "serverProfileSecrets", "sec1"))
      );
    });

    it(`denies ${who} writing a secret`, async () => {
      await assertFails(
        setDoc(doc(db(who), "stores", STORE_A, "serverProfileSecrets", "sec1"), { hash: "x" })
      );
    });
  }

  it("still lets the shift roles read the profile roster itself", async () => {
    for (const who of ["cashier", "server", "kitchen"] as const) {
      await assertSucceeds(
        getDoc(doc(db(who), "stores", STORE_A, "serverProfiles", "p1"))
      );
    }
  });
});

describe("cross-store access", () => {
  it("denies a manager of store A writing store B config", async () => {
    await assertFails(setDoc(doc(db("manager"), "stores", STORE_B, "inventory", "x"), { v: 1 }));
  });

  it("denies a manager of store B reading store A receipts (§2 fallback scoping)", async () => {
    await assertFails(getDoc(doc(db("managerB"), "stores", STORE_A, "receipts", "r1")));
  });

  it("denies a cashier of store A reading store B receipts", async () => {
    await assertFails(getDoc(doc(db("cashier"), "stores", STORE_B, "receipts", "r1")));
  });

  it("still allows reading your own store", async () => {
    await assertSucceeds(getDoc(doc(db("cashier"), "stores", STORE_A, "receipts", "r1")));
  });

  it("still allows an admin to read any store", async () => {
    await assertSucceeds(getDoc(doc(db("admin"), "stores", STORE_B, "receipts", "r1")));
  });
});

describe("§2 collection-group reads must be store-filtered", () => {
  it("denies an unfiltered collectionGroup('kitchentickets') for a single-store manager", async () => {
    await assertFails(getDocs(query(collectionGroup(db("manager"), "kitchentickets"))));
  });

  it("allows the same query when filtered by storeId", async () => {
    await assertSucceeds(
      getDocs(
        query(collectionGroup(db("manager"), "kitchentickets"), where("storeId", "==", STORE_A))
      )
    );
  });

  it("denies a store-filtered query for a store the user cannot access", async () => {
    await assertFails(
      getDocs(
        query(collectionGroup(db("manager"), "kitchentickets"), where("storeId", "==", STORE_B))
      )
    );
  });
});

describe("§3 PIN fields on activeSessions cannot be forged", () => {
  it("denies a cashier changing customerPin", async () => {
    await assertFails(
      setDoc(
        doc(db("cashier"), "stores", STORE_A, "activeSessions", "s1"),
        { customerPin: "9999" },
        { merge: true }
      )
    );
  });

  it("denies a cashier enabling customer access", async () => {
    await assertFails(
      setDoc(
        doc(db("cashier"), "stores", STORE_A, "activeSessions", "s1"),
        { customerAccessEnabled: false },
        { merge: true }
      )
    );
  });

  it("allows a cashier to update non-PIN fields", async () => {
    await assertSucceeds(
      setDoc(
        doc(db("cashier"), "stores", STORE_A, "activeSessions", "s1"),
        { tableId: "t2" },
        { merge: true }
      )
    );
  });

  it("allows writing an activeSessions subcollection doc that has no PIN fields", async () => {
    await assertSucceeds(
      setDoc(
        doc(db("cashier"), "stores", STORE_A, "activeSessions", "s1", "customerParticipants", "p1"),
        { status: "active" }
      )
    );
  });

  // `write` covers delete, and request.resource is null on a delete — so a
  // pinFieldsUnchanged() guard applied to `write` would deny this and break
  // every payment and void. Both delete the activeSessions doc.
  it("still allows a cashier to DELETE the activeSessions doc (payment / void path)", async () => {
    await assertSucceeds(
      deleteDoc(doc(db("cashier"), "stores", STORE_A, "activeSessions", "s1"))
    );
  });

  it("still allows a cashier to delete an activeSessions subcollection doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore() as any, "stores", STORE_A, "activeSessions", "s1", "customerParticipants", "p2"),
        { status: "active" }
      );
    });
    await assertSucceeds(
      deleteDoc(
        doc(db("cashier"), "stores", STORE_A, "activeSessions", "s1", "customerParticipants", "p2")
      )
    );
  });
});

describe("deletes on operational collections stay open", () => {
  for (const coll of ["sessions", "waitlist", "reservations", "rtKdsTickets", "closedSessions"] as const) {
    it(`allows a cashier to delete from ${coll}`, async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore() as any, "stores", STORE_A, coll, "d1"), { v: 1 });
      });
      await assertSucceeds(deleteDoc(doc(db("cashier"), "stores", STORE_A, coll, "d1")));
    });
  }

  it("denies a cashier deleting from a config collection", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as any, "stores", STORE_A, "inventory", "d1"), { v: 1 });
    });
    await assertFails(deleteDoc(doc(db("cashier"), "stores", STORE_A, "inventory", "d1")));
  });

  it("allows a manager to delete from a config collection", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as any, "stores", STORE_A, "menuSchedules", "d1"), { v: 1 });
    });
    await assertSucceeds(deleteDoc(doc(db("manager"), "stores", STORE_A, "menuSchedules", "d1")));
  });
});

describe("§4 a deactivated admin loses access", () => {
  it("denies a disabled admin writing config", async () => {
    await assertFails(
      setDoc(doc(db("disabledAdmin"), "stores", STORE_A, "inventory", "x"), { v: 1 })
    );
  });

  it("denies a disabled admin writing operational data", async () => {
    await assertFails(
      setDoc(doc(db("disabledAdmin"), "stores", STORE_A, "sessions", "x"), { v: 1 })
    );
  });

  it("denies a disabled admin writing the global product catalog", async () => {
    await assertFails(setDoc(doc(db("disabledAdmin"), "products", "p1"), { name: "x" }));
  });

  it("denies a disabled admin reading another store", async () => {
    await assertFails(getDoc(doc(db("disabledAdmin"), "stores", STORE_B, "receipts", "r1")));
  });
});

describe("global catalog writes remain admin-only", () => {
  it("denies a manager creating a product directly", async () => {
    await assertFails(setDoc(doc(db("manager"), "products", "p1"), { name: "x" }));
  });

  it("denies a manager writing productRequests directly (API-only)", async () => {
    await assertFails(setDoc(doc(db("manager"), "productRequests", "pr1"), { status: "approved" }));
  });

  it("denies a manager writing productPhotoRequests directly (API-only)", async () => {
    await assertFails(
      setDoc(doc(db("manager"), "productPhotoRequests", "storeA_p1"), { status: "approved" })
    );
  });

  it("denies an admin writing productPhotoRequests directly (API-only)", async () => {
    await assertFails(
      setDoc(doc(db("admin"), "productPhotoRequests", "storeA_p1"), { status: "approved" })
    );
  });

  it("allows staff to read productPhotoRequests", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as any, "productPhotoRequests", "storeA_p1"), {
        storeId: STORE_A,
        productId: "p1",
        status: "pending",
      });
    });
    await assertSucceeds(getDoc(doc(db("cashier"), "productPhotoRequests", "storeA_p1")));
  });

  it("allows an active admin to create a product", async () => {
    await assertSucceeds(setDoc(doc(db("admin"), "products", "p1"), { name: "x" }));
  });
});

describe("sanity: the config list in the rules matches this test's list", () => {
  it("has no duplicates and no overlap with the open list", () => {
    expect(new Set(CONFIG_COLLECTIONS).size).toBe(CONFIG_COLLECTIONS.length);
    const open = new Set<string>(OPEN_COLLECTIONS);
    for (const c of CONFIG_COLLECTIONS) expect(open.has(c)).toBe(false);
  });
});
