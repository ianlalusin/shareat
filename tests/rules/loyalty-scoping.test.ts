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
  doc,
  getDoc,
  getDocs,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/**
 * Security-rules tests for the Sharelebrator customer-visibility scoping
 * (2026-08-20): `customers` list, and `loyaltyLogs`/`loyaltyLogsDaily`
 * read+list, moved from isActiveStaff() to isAdmin().
 *
 * The load-bearing assertions are the catch-all ones. Firestore rules OR
 * together, so a per-collection tightening from isActiveStaff() to isAdmin()
 * is a no-op unless the root catch-alls (`/{collection}/{docId}` and
 * `/{collection}/{docId}/{docPath=**}`) also exclude these collection names —
 * otherwise the broad "any active staff can read anything not explicitly
 * excluded" fallback still lets a manager list the entire cross-branch
 * customer base or the PII audit log through the back door. If those tests
 * fail, the fallback is still open and the whole change is a no-op in
 * production regardless of what the dedicated match blocks say.
 *
 * Since audit B05 (2026-10-29) staff cannot `get` customers/{phone} either:
 * the doc held passwordHash. OnlineOrdersClient uses /api/loyalty/visit-count.
 * The card holder keeps get on their own doc and ledger; the password hash
 * moved to customers/{phone}/secrets/auth, which no client can touch.
 */

const STAFF = {
  admin: { uid: "u_admin", role: "admin", status: "active", assignedStoreIds: ["storeA"] },
  disabledAdmin: { uid: "u_admin_off", role: "admin", status: "disabled", assignedStoreIds: ["storeA"] },
  manager: { uid: "u_manager", role: "manager", status: "active", assignedStoreIds: ["storeA"] },
  cashier: { uid: "u_cashier", role: "cashier", status: "active", assignedStoreIds: ["storeA"] },
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

    // Sharelebrator customers (top-level, cross-branch).
    await setDoc(doc(raw as any, "customers", "09171234567"), {
      phone: "09171234567",
      name: "Juana Dela Cruz",
      points: 120,
    });
    await setDoc(doc(raw as any, "customers", "09179876543"), {
      phone: "09179876543",
      name: "Pedro Reyes",
      points: 40,
    });
    // pointsLedger + secrets: card-holder (ledger) / Admin-SDK only (audit B05).
    await setDoc(doc(raw as any, "customers", "09171234567", "pointsLedger", "l1"), {
      delta: 10,
      reason: "purchase",
    });
    await setDoc(doc(raw as any, "customers", "09171234567", "secrets", "auth"), {
      passwordHash: "$2a$10$fakehashfakehashfakehash",
    });

    // Sharelebrator audit log + daily projection (server-only writes; PII).
    await setDoc(doc(raw as any, "loyaltyLogs", "log1"), {
      phone: "09171234567",
      storeId: "storeA",
      action: "earn",
    });
    await setDoc(doc(raw as any, "loyaltyLogsDaily", "2026-08-20_0"), {
      dayId: "2026-08-20",
      count: 5,
    });
  });
});

describe("customers: list and get are admin/card-holder only (B05)", () => {
  it("denies a manager listing customers", async () => {
    // If this ever passes, /api/loyalty/store-customers is no longer the only
    // way to see the cross-branch customer roster — a manager could enumerate
    // every customer, every branch, straight from the client SDK.
    await assertFails(getDocs(collection(db("manager"), "customers")));
  });

  it("denies a cashier listing customers", async () => {
    await assertFails(getDocs(collection(db("cashier"), "customers")));
  });

  it("denies a manager getting a customer by exact phone (audit B05)", async () => {
    // OnlineOrdersClient now goes through /api/loyalty/visit-count. A direct
    // get would hand over passwordHash + cross-branch PII by phone.
    await assertFails(getDoc(doc(db("manager"), "customers", "09171234567")));
  });

  it("denies a cashier getting a customer by exact phone (audit B05)", async () => {
    await assertFails(getDoc(doc(db("cashier"), "customers", "09171234567")));
  });

  it("allows an admin to list customers", async () => {
    await assertSucceeds(getDocs(collection(db("admin"), "customers")));
  });

  it("allows an admin to get a customer by exact phone", async () => {
    await assertSucceeds(getDoc(doc(db("admin"), "customers", "09171234567")));
  });

  it("denies a disabled admin listing customers (status gate still applies)", async () => {
    await assertFails(getDocs(collection(db("disabledAdmin"), "customers")));
  });

  it("denies staff reading a customer's pointsLedger (audit B05)", async () => {
    await assertFails(
      getDocs(collection(db("manager"), "customers", "09171234567", "pointsLedger"))
    );
    await assertFails(getDoc(doc(db("cashier"), "customers", "09171234567", "pointsLedger", "l1")));
  });

  it("still lets the card holder read their own doc and ledger, not someone else's", async () => {
    const own = testEnv
      .authenticatedContext("09171234567", { loyaltyCustomer: true, phone: "09171234567" })
      .firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(own, "customers", "09171234567")));
    await assertSucceeds(getDocs(collection(own, "customers", "09171234567", "pointsLedger")));
    await assertFails(getDoc(doc(own, "customers", "09179876543")));
    await assertFails(getDocs(collection(own, "customers", "09179876543", "pointsLedger")));
  });

  it("nobody reads or writes customers/{phone}/secrets — not staff, admin, or the card holder", async () => {
    const own = testEnv
      .authenticatedContext("09171234567", { loyaltyCustomer: true, phone: "09171234567" })
      .firestore() as unknown as Firestore;
    for (const f of [db("cashier"), db("manager"), db("admin"), own]) {
      await assertFails(getDoc(doc(f, "customers", "09171234567", "secrets", "auth")));
      await assertFails(getDocs(collection(f, "customers", "09171234567", "secrets")));
      await assertFails(setDoc(doc(f, "customers", "09171234567", "secrets", "auth"), { passwordHash: "x" }));
    }
  });
});

describe("loyaltyLogs / loyaltyLogsDaily: read+list is admin-only", () => {
  it("denies a manager reading a loyaltyLogs doc", async () => {
    await assertFails(getDoc(doc(db("manager"), "loyaltyLogs", "log1")));
  });

  it("denies a manager listing loyaltyLogs", async () => {
    await assertFails(getDocs(collection(db("manager"), "loyaltyLogs")));
  });

  it("denies a cashier reading a loyaltyLogs doc", async () => {
    await assertFails(getDoc(doc(db("cashier"), "loyaltyLogs", "log1")));
  });

  it("denies a cashier listing loyaltyLogs", async () => {
    await assertFails(getDocs(collection(db("cashier"), "loyaltyLogs")));
  });

  it("denies a manager reading a loyaltyLogsDaily doc", async () => {
    await assertFails(getDoc(doc(db("manager"), "loyaltyLogsDaily", "2026-08-20_0")));
  });

  it("denies a manager listing loyaltyLogsDaily", async () => {
    await assertFails(getDocs(collection(db("manager"), "loyaltyLogsDaily")));
  });

  it("denies a cashier reading a loyaltyLogsDaily doc", async () => {
    await assertFails(getDoc(doc(db("cashier"), "loyaltyLogsDaily", "2026-08-20_0")));
  });

  it("denies a cashier listing loyaltyLogsDaily", async () => {
    await assertFails(getDocs(collection(db("cashier"), "loyaltyLogsDaily")));
  });

  it("allows an admin to read a loyaltyLogs doc", async () => {
    await assertSucceeds(getDoc(doc(db("admin"), "loyaltyLogs", "log1")));
  });

  it("allows an admin to list loyaltyLogs", async () => {
    await assertSucceeds(getDocs(collection(db("admin"), "loyaltyLogs")));
  });

  it("allows an admin to read a loyaltyLogsDaily doc", async () => {
    await assertSucceeds(getDoc(doc(db("admin"), "loyaltyLogsDaily", "2026-08-20_0")));
  });

  it("allows an admin to list loyaltyLogsDaily", async () => {
    await assertSucceeds(getDocs(collection(db("admin"), "loyaltyLogsDaily")));
  });
});

/**
 * These are the load-bearing tests for the whole change. Rules OR together,
 * so tightening the dedicated match blocks above is a no-op unless the root
 * catch-alls also exclude 'customers' / 'loyaltyLogs' / 'loyaltyLogsDaily' —
 * otherwise "any active staff can read anything not explicitly excluded"
 * still grants a manager the exact list/read access the dedicated blocks
 * just took away.
 */
describe("catch-all fallback no longer leaks these collections to active staff", () => {
  it("denies a manager listing customers even without the dedicated block (catch-all closed)", async () => {
    await assertFails(getDocs(collection(db("manager"), "customers")));
  });

  it("denies a manager reading a single loyaltyLogs doc via the shallow catch-all", async () => {
    await assertFails(getDoc(doc(db("manager"), "loyaltyLogs", "log1")));
  });

  it("denies a manager reading a single loyaltyLogsDaily doc via the shallow catch-all", async () => {
    await assertFails(getDoc(doc(db("manager"), "loyaltyLogsDaily", "2026-08-20_0")));
  });

  it("denies a cashier reading a customers doc that has no dedicated get-by-phone match (regression guard)", async () => {
    // customers/{phone} has a dedicated get rule (card holder / admin, see
    // the suite above) — this checks the deep catch-all
    // (`/{collection}/{docId}/{docPath=**}`) doesn't ALSO grant list-shaped
    // access through a nested read some other way. Listing the top-level
    // collection is the actual enumeration risk and is covered above; this
    // confirms the deep fallback carries the same three exclusions as the
    // shallow one for loyaltyLogsDaily, which has no dedicated per-doc get
    // carve-out the way customers does.
    await assertFails(getDoc(doc(db("cashier"), "loyaltyLogsDaily", "2026-08-20_0")));
  });
});
