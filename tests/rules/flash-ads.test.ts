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
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/**
 * Security-rules tests for flash ads — the one collection the customer Hub
 * reads straight from Firestore rather than through an Admin-SDK route.
 *
 * The collection had no rule here at all, so every Hub load logged a
 * permission-denied and no diner ever saw an ad. That is the failure mode
 * worth pinning: it is silent from the store's side (staff see the ad in the
 * admin list and assume it ran) and only visible in the diner's console.
 *
 * The load-bearing assertion is the UNFILTERED list being denied while the
 * active-filtered one succeeds. Rules cannot evaluate resource.data across a
 * query, so an unconstrained getDocs() can never be allowed by an
 * active-checking rule — which is exactly what keeps a draft ad off a diner's
 * screen. If someone "fixes" a future denial by dropping the active check from
 * the rule, that test goes green and this one goes red.
 */

const STORE_A = "storeA";
const STORE_B = "storeB";

let testEnv: RulesTestEnvironment;

/** A customer token as /api/customer/exchange-pin mints it. */
function customerDb(storeId: string): Firestore {
  return testEnv
    .authenticatedContext(`cust_${storeId}`, { customer: true, storeId })
    .firestore() as unknown as Firestore;
}

/** Store-scoped staff, who reach flashAds through the stores/{coll} catch-all. */
function staffDb(): Firestore {
  return testEnv
    .authenticatedContext("u_cashier")
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
    const db = ctx.firestore();
    // Staff identity lives in `staff/{uid}` — see staffData() in firestore.rules.
    await db.doc(`staff/u_cashier`).set({
      name: "u_cashier",
      role: "cashier",
      status: "active",
      assignedStoreIds: [STORE_A],
    });
    await db.doc(`stores/${STORE_A}/flashAds/live`).set({
      active: true,
      imageUrl: "https://example.test/live.png",
      clickBehavior: "close",
    });
    await db.doc(`stores/${STORE_A}/flashAds/draft`).set({
      active: false,
      imageUrl: "https://example.test/draft.png",
      clickBehavior: "close",
    });
    await db.doc(`stores/${STORE_B}/flashAds/live`).set({
      active: true,
      imageUrl: "https://example.test/other-store.png",
      clickBehavior: "close",
    });
  });
});

describe("flash ads — customer read", () => {
  it("lets a diner list the active ads for their own store (the Hub's query)", async () => {
    const db = customerDb(STORE_A);
    const q = query(collection(db, `stores/${STORE_A}/flashAds`), where("active", "==", true));
    await assertSucceeds(getDocs(q));
  });

  it("denies an UNFILTERED list — this is what keeps drafts off a diner's screen", async () => {
    // Rules cannot test resource.data across a query, so an unconstrained read
    // can never be served by the active-checking rule. The Hub must query
    // where('active','==',true).
    const db = customerDb(STORE_A);
    await assertFails(getDocs(collection(db, `stores/${STORE_A}/flashAds`)));
  });

  it("denies getting an inactive ad directly by id", async () => {
    const db = customerDb(STORE_A);
    await assertFails(getDoc(doc(db, `stores/${STORE_A}/flashAds/draft`)));
  });

  it("allows getting an active ad directly by id", async () => {
    const db = customerDb(STORE_A);
    await assertSucceeds(getDoc(doc(db, `stores/${STORE_A}/flashAds/live`)));
  });

  it("scopes a diner to their own store's ads", async () => {
    // The token carries storeId; another store's promos are not theirs to read.
    const db = customerDb(STORE_A);
    const q = query(collection(db, `stores/${STORE_B}/flashAds`), where("active", "==", true));
    await assertFails(getDocs(q));
  });

  it("never lets a diner write an ad", async () => {
    const db = customerDb(STORE_A);
    const { setDoc } = await import("firebase/firestore");
    await assertFails(
      setDoc(doc(db, `stores/${STORE_A}/flashAds/injected`), {
        active: true,
        imageUrl: "https://evil.test/x.png",
      })
    );
  });
});

describe("flash ads — staff access is unchanged", () => {
  it("still lets store staff list every ad, drafts included", async () => {
    // Staff reach flashAds through the stores/{storeId}/{coll} catch-all, which
    // the customer block must not have narrowed.
    const db = staffDb();
    await assertSucceeds(getDocs(collection(db, `stores/${STORE_A}/flashAds`)));
  });

  it("still lets store staff read a draft directly", async () => {
    const db = staffDb();
    await assertSucceeds(getDoc(doc(db, `stores/${STORE_A}/flashAds/draft`)));
  });

  it("does not let staff reach another store's ads", async () => {
    const db = staffDb();
    await assertFails(getDocs(collection(db, `stores/${STORE_B}/flashAds`)));
  });
});
