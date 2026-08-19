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
 * Equally load-bearing in the OTHER direction: `customers/{phone}` `get`
 * (exact-phone lookup, not list) must stay open to active staff, because
 * OnlineOrdersClient.tsx looks up a customer by phone this way on every
 * online order. If that assertion fails, online order intake breaks.
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
    // pointsLedger subcollection stays deliberately open to staff — its own
    // match block, not the catch-all, grants isActiveStaff() get/list.
    await setDoc(doc(raw as any, "customers", "09171234567", "pointsLedger", "l1"), {
      delta: 10,
      reason: "purchase",
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

describe("customers: list is admin-only, get stays open to staff", () => {
  it("denies a manager listing customers", async () => {
    // If this ever passes, /api/loyalty/store-customers is no longer the only
    // way to see the cross-branch customer roster — a manager could enumerate
    // every customer, every branch, straight from the client SDK.
    await assertFails(getDocs(collection(db("manager"), "customers")));
  });

  it("denies a cashier listing customers", async () => {
    await assertFails(getDocs(collection(db("cashier"), "customers")));
  });

  it("allows a manager to get a customer by exact phone (OnlineOrdersClient path)", async () => {
    // This is the load-bearing assertion in the OTHER direction: if this
    // starts failing, online order intake breaks for every store, because
    // OnlineOrdersClient.tsx looks customers up by exact phone this way.
    await assertSucceeds(getDoc(doc(db("manager"), "customers", "09171234567")));
  });

  it("allows a cashier to get a customer by exact phone (OnlineOrdersClient path)", async () => {
    await assertSucceeds(getDoc(doc(db("cashier"), "customers", "09171234567")));
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

  it("still allows a manager to list a customer's pointsLedger subcollection", async () => {
    // Regression guard: the catch-all exclusion added for 'customers' must not
    // have collaterally closed the pointsLedger subcollection, which has its
    // own dedicated match block granting isActiveStaff() get/list and is
    // deliberately still open — the cashier UI reads a customer's point
    // history on this path.
    await assertSucceeds(
      getDocs(collection(db("manager"), "customers", "09171234567", "pointsLedger"))
    );
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
    // customers/{phone} DOES have a dedicated get rule (isActiveStaff() passes
    // here deliberately, see the suite above) — this checks the deep catch-all
    // (`/{collection}/{docId}/{docPath=**}`) doesn't ALSO grant list-shaped
    // access through a nested read some other way. Listing the top-level
    // collection is the actual enumeration risk and is covered above; this
    // confirms the deep fallback carries the same three exclusions as the
    // shallow one for loyaltyLogsDaily, which has no dedicated per-doc get
    // carve-out the way customers does.
    await assertFails(getDoc(doc(db("cashier"), "loyaltyLogsDaily", "2026-08-20_0")));
  });
});
