import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/**
 * Audit B22 (2026-10-29): direct-data token revocation.
 *
 * The API routes verify with checkRevoked=true, but Firestore/Storage rules
 * cannot see Firebase's revocation list, so an ID token minted before an admin
 * password reset kept working against direct reads/writes for up to an hour
 * while the staffer stayed `active`. The reset route now writes a server-owned
 * staff/{uid}.tokensValidAfter (epoch seconds) and the shared helpers require
 * request.auth.token.auth_time > tokensValidAfter.
 *
 * Firestore cases run under plain `npm run test:rules`; the Storage cases need
 * the Storage emulator too (the npm script boots both).
 */

const STORE_A = "storeA";
const BOUNDARY = 1_800_000_000; // epoch seconds of the "reset"
const OLD = BOUNDARY - 60; // signed in before the reset
const FRESH = BOUNDARY + 60; // signed in again after it
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMG = { contentType: "image/png" };

const STAFF = {
  cashier: { uid: "u_cashier", role: "cashier", status: "active", fence: true },
  manager: { uid: "u_manager", role: "manager", status: "active", fence: true },
  admin: { uid: "u_admin", role: "admin", status: "active", fence: true },
  platform: { uid: "u_platform", role: "admin", status: "active", fence: true },
  disabled: { uid: "u_disabled", role: "cashier", status: "disabled", fence: true },
  // Never reset: no tokensValidAfter field at all (every existing staff doc).
  legacy: { uid: "u_legacy", role: "cashier", status: "active", fence: false },
} as const;
type StaffKey = keyof typeof STAFF;

const hasStorageEmulator = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;

let testEnv: RulesTestEnvironment;

function ctx(who: StaffKey, authTime: number) {
  const claims: Record<string, unknown> = { auth_time: authTime, iat: authTime };
  if (who === "platform") claims.platformAdmin = true;
  return testEnv.authenticatedContext(STAFF[who].uid, claims);
}
function db(who: StaffKey, authTime: number): Firestore {
  return ctx(who, authTime).firestore() as unknown as Firestore;
}

beforeAll(async () => {
  const storage = hasStorageEmulator
    ? (() => {
        const [h, p] = String(process.env.FIREBASE_STORAGE_EMULATOR_HOST).split(":");
        return {
          rules: readFileSync(resolve(__dirname, "../../storage.rules"), "utf8"),
          host: h || "127.0.0.1",
          port: Number(p) || 9199,
        };
      })()
    : undefined;
  testEnv = await initializeTestEnvironment({
    projectId: "demo-pos",
    firestore: {
      rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
    ...(storage ? { storage } : {}),
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (c) => {
    const raw = c.firestore() as any;
    for (const s of Object.values(STAFF)) {
      await setDoc(doc(raw, "staff", s.uid), {
        role: s.role,
        status: s.status,
        assignedStoreIds: [STORE_A],
        ...(s.fence ? { tokensValidAfter: BOUNDARY } : {}),
      });
    }
    await setDoc(doc(raw, "stores", STORE_A, "activeSessions", "s1"), { status: "active" });
    await setDoc(doc(raw, "stores", STORE_A), { name: "A" });
  });
});

describe("B22 Firestore: tokens issued before the boundary are denied", () => {
  for (const who of ["cashier", "manager", "admin"] as const) {
    it(`denies ${who} with an old token reading store data`, async () => {
      await assertFails(getDoc(doc(db(who, OLD), "stores", STORE_A, "activeSessions", "s1")));
    });
    it(`allows ${who} with a fresh token reading store data`, async () => {
      await assertSucceeds(getDoc(doc(db(who, FRESH), "stores", STORE_A, "activeSessions", "s1")));
    });
  }

  it("denies an old-token write to store data", async () => {
    await assertFails(
      setDoc(doc(db("cashier", OLD), "stores", STORE_A, "activeSessions", "s2"), { status: "active" }),
    );
  });

  it("allows a fresh-token write to store data", async () => {
    await assertSucceeds(
      setDoc(doc(db("cashier", FRESH), "stores", STORE_A, "activeSessions", "s2"), { status: "active" }),
    );
  });

  it("denies a token whose auth_time equals the boundary (same-second sign-in is ambiguous)", async () => {
    await assertFails(getDoc(doc(db("cashier", BOUNDARY), "stores", STORE_A, "activeSessions", "s1")));
  });

  it("denies the platformAdmin claim path with an old token", async () => {
    await assertFails(getDoc(doc(db("platform", OLD), "stores", STORE_A)));
  });

  it("allows the platformAdmin claim path with a fresh token", async () => {
    await assertSucceeds(getDoc(doc(db("platform", FRESH), "stores", STORE_A)));
  });

  it("keeps the platformAdmin break-glass working with no staff doc", async () => {
    const f = testEnv
      .authenticatedContext("u_no_staff_doc", { platformAdmin: true, auth_time: OLD })
      .firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(f, "stores", STORE_A)));
  });

  it("does not change anything for staff who were never reset (no field)", async () => {
    await assertSucceeds(getDoc(doc(db("legacy", OLD), "stores", STORE_A, "activeSessions", "s1")));
  });

  it("keeps inactive staff denied even with a fresh token", async () => {
    await assertFails(getDoc(doc(db("disabled", FRESH), "stores", STORE_A, "activeSessions", "s1")));
  });
});

describe("B22 Firestore: tokensValidAfter is server-owned", () => {
  it("still lets an old-token user read their own staff doc (client needs its status)", async () => {
    await assertSucceeds(getDoc(doc(db("cashier", OLD), "staff", STAFF.cashier.uid)));
  });

  it("denies a staffer lowering their own boundary", async () => {
    await assertFails(updateDoc(doc(db("cashier", FRESH), "staff", STAFF.cashier.uid), { tokensValidAfter: 0 }));
  });

  it("denies an admin lowering their own boundary, even with a fresh token", async () => {
    await assertFails(updateDoc(doc(db("admin", FRESH), "staff", STAFF.admin.uid), { tokensValidAfter: 0 }));
  });

  it("denies an admin clearing another staffer's boundary", async () => {
    await assertFails(updateDoc(doc(db("admin", FRESH), "staff", STAFF.cashier.uid), { tokensValidAfter: 1 }));
  });

  it("denies an admin dropping the field with a full overwrite", async () => {
    await assertFails(
      setDoc(doc(db("admin", FRESH), "staff", STAFF.cashier.uid), {
        role: "cashier",
        status: "active",
        assignedStoreIds: [STORE_A],
      }),
    );
  });

  it("still allows normal admin edits that leave the boundary alone", async () => {
    await assertSucceeds(updateDoc(doc(db("admin", FRESH), "staff", STAFF.cashier.uid), { status: "disabled" }));
  });

  it("denies a self-signup create that carries a boundary", async () => {
    const f = testEnv.authenticatedContext("u_new", { auth_time: FRESH }).firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(f, "staff", "u_new"), {
        role: "server",
        status: "pending",
        assignedStoreIds: [],
        tokensValidAfter: 0,
      }),
    );
  });

  it("still allows the plain self-signup create", async () => {
    const f = testEnv.authenticatedContext("u_new", { auth_time: FRESH }).firestore() as unknown as Firestore;
    await assertSucceeds(setDoc(doc(f, "staff", "u_new"), { role: "server", status: "pending", assignedStoreIds: [] }));
  });
});

describe.skipIf(!hasStorageEmulator)("B22 Storage: tokens issued before the boundary are denied", () => {
  beforeEach(async () => {
    await testEnv.clearStorage();
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await Promise.resolve(c.storage().ref(`paymentProofs/${STORE_A}/p1.jpg`).put(PNG, IMG));
    });
  });

  function put(who: StaffKey, authTime: number, path: string) {
    return Promise.resolve(ctx(who, authTime).storage().ref(path).put(PNG, IMG));
  }
  function get(who: StaffKey, authTime: number, path: string) {
    return ctx(who, authTime).storage().ref(path).getMetadata();
  }

  it("denies an old-token cashier reading a payment proof", async () => {
    await assertFails(get("cashier", OLD, `paymentProofs/${STORE_A}/p1.jpg`));
  });
  it("allows a fresh-token cashier reading a payment proof", async () => {
    await assertSucceeds(get("cashier", FRESH, `paymentProofs/${STORE_A}/p1.jpg`));
  });
  it("denies an old-token cashier uploading a payment proof", async () => {
    await assertFails(put("cashier", OLD, `paymentProofs/${STORE_A}/new.jpg`));
  });
  it("allows a fresh-token cashier uploading a payment proof", async () => {
    await assertSucceeds(put("cashier", FRESH, `paymentProofs/${STORE_A}/new.jpg`));
  });
  it("denies an old-token manager uploading a product image (role-only helper)", async () => {
    await assertFails(put("manager", OLD, "Items/p9.webp"));
  });
  it("allows a fresh-token manager uploading a product image", async () => {
    await assertSucceeds(put("manager", FRESH, "Items/p9.webp"));
  });
  it("denies an old-token admin uploading a loyalty reward image", async () => {
    await assertFails(put("admin", OLD, "loyaltyRewardImages/r1/a.png"));
  });
  it("allows a fresh-token admin uploading a loyalty reward image", async () => {
    await assertSucceeds(put("admin", FRESH, "loyaltyRewardImages/r1/a.png"));
  });
  it("denies an old-token staffer overwriting their own avatar", async () => {
    await assertFails(put("cashier", OLD, `users/${STAFF.cashier.uid}/avatar.jpg`));
  });
  it("allows a fresh-token staffer uploading their own avatar", async () => {
    await assertSucceeds(put("cashier", FRESH, `users/${STAFF.cashier.uid}/avatar.jpg`));
  });
  it("leaves the avatar upload unchanged for an account with no staff doc", async () => {
    const s = testEnv.authenticatedContext("u_no_staff", { auth_time: OLD }).storage();
    await assertSucceeds(Promise.resolve(s.ref("users/u_no_staff/avatar.jpg").put(PNG, IMG)));
  });
  it("keeps never-reset staff working (no field)", async () => {
    await assertSucceeds(get("legacy", OLD, `paymentProofs/${STORE_A}/p1.jpg`));
  });
  it("keeps inactive staff denied with a fresh token", async () => {
    await assertFails(get("disabled", FRESH, `paymentProofs/${STORE_A}/p1.jpg`));
  });
});
