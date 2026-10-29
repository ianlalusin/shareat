import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/**
 * Storage security-rules tests (audit B18 / B19, 2026-10-29).
 *
 * B18: the bucket used to be `allow read` at the root — every object, payment
 * proofs included, was publicly readable AND listable. Now reads are per
 * prefix, get-only, and payment proofs need active membership in that store.
 * B19: payment proofs and productPhotos are create-only — a second upload to
 * an existing key (e.g. the photo an admin already promoted) is denied.
 *
 * Needs the Storage AND Firestore emulators (storage rules read staff/{uid}
 * cross-service). `npm run test:rules` only boots Firestore, so this suite
 * skips itself there; run it with:
 *   npx firebase emulators:exec --only firestore,storage --project demo-pos \
 *     "vitest run --config vitest.rules.config.ts tests/rules/storage.test.ts"
 */

const hasStorageEmulator = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;

const STORE_A = "storeA";
const STORE_B = "storeB";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMG = { contentType: "image/png" };

const STAFF = {
  cashierA: { uid: "u_cashier_a", role: "cashier", status: "active", assignedStoreIds: [STORE_A] },
  cashierB: { uid: "u_cashier_b", role: "cashier", status: "active", assignedStoreIds: [STORE_B] },
  managerA: { uid: "u_manager_a", role: "manager", status: "active", assignedStoreIds: [STORE_A] },
  disabledA: { uid: "u_off_a", role: "cashier", status: "disabled", assignedStoreIds: [STORE_A] },
} as const;

let testEnv: RulesTestEnvironment;

function storageAs(who: keyof typeof STAFF | "anon") {
  const ctx = who === "anon" ? testEnv.unauthenticatedContext() : testEnv.authenticatedContext(STAFF[who].uid);
  return ctx.storage();
}

/** Compat UploadTask is thenable but not typed as a Promise. */
function put(ref: { put: (d: Uint8Array, m: object) => PromiseLike<unknown> }): Promise<unknown> {
  return Promise.resolve(ref.put(PNG, IMG));
}

/** Puts an object with rules disabled, as the Admin SDK / an earlier upload would. */
async function seed(path: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await put(ctx.storage().ref(path));
  });
}

describe.skipIf(!hasStorageEmulator)("storage rules", () => {
  beforeAll(async () => {
    const [sHost, sPort] = String(process.env.FIREBASE_STORAGE_EMULATOR_HOST).split(":");
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pos",
      firestore: {
        rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"),
        host: "127.0.0.1",
        port: 8080,
      },
      storage: {
        rules: readFileSync(resolve(__dirname, "../../storage.rules"), "utf8"),
        host: sHost || "127.0.0.1",
        port: Number(sPort) || 9199,
      },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearStorage();
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const s of Object.values(STAFF)) {
        await db.doc(`staff/${s.uid}`).set({
          role: s.role,
          status: s.status,
          assignedStoreIds: s.assignedStoreIds,
        });
      }
    });
    await seed(`paymentProofs/${STORE_A}/proof1.jpg`);
    await seed(`productPhotos/p1/${STORE_A}/photo1.webp`);
    await seed(`Items/p1.webp`);
  });

  describe("B18: no public read or listing of payment proofs", () => {
    it("denies an anonymous get of a proof", async () => {
      await assertFails(storageAs("anon").ref(`paymentProofs/${STORE_A}/proof1.jpg`).getMetadata());
    });

    it("denies an anonymous list of the proofs prefix", async () => {
      await assertFails(storageAs("anon").ref(`paymentProofs/${STORE_A}`).listAll());
    });

    it("denies an anonymous list of the bucket root", async () => {
      await assertFails(storageAs("anon").ref("").listAll());
    });

    it("denies a signed-in staffer listing proofs, even for their own store", async () => {
      await assertFails(storageAs("cashierA").ref(`paymentProofs/${STORE_A}`).listAll());
    });

    it("denies a staffer of another store reading the proof", async () => {
      await assertFails(storageAs("cashierB").ref(`paymentProofs/${STORE_A}/proof1.jpg`).getMetadata());
    });

    it("denies a deactivated staffer of the store reading the proof", async () => {
      await assertFails(storageAs("disabledA").ref(`paymentProofs/${STORE_A}/proof1.jpg`).getMetadata());
    });

    it("lets an active staffer of the store read the proof (getDownloadURL path)", async () => {
      await assertSucceeds(storageAs("cashierA").ref(`paymentProofs/${STORE_A}/proof1.jpg`).getMetadata());
    });

    it("still lets anyone get a public product image by path", async () => {
      await assertSucceeds(storageAs("anon").ref(`Items/p1.webp`).getMetadata());
    });

    it("denies listing the public Items prefix", async () => {
      await assertFails(storageAs("anon").ref(`Items`).listAll());
    });

    it("denies reading an object under an unknown prefix", async () => {
      await seed(`somethingElse/x.png`);
      await assertFails(storageAs("cashierA").ref(`somethingElse/x.png`).getMetadata());
    });
  });

  describe("B19: payment proofs and productPhotos are create-only", () => {
    it("lets a store cashier upload a new proof", async () => {
      await assertSucceeds(put(storageAs("cashierA").ref(`paymentProofs/${STORE_A}/proof2.jpg`)));
    });

    it("denies overwriting an existing proof", async () => {
      await assertFails(put(storageAs("cashierA").ref(`paymentProofs/${STORE_A}/proof1.jpg`)));
    });

    it("denies deleting a proof", async () => {
      await assertFails(storageAs("cashierA").ref(`paymentProofs/${STORE_A}/proof1.jpg`).delete());
    });

    it("denies a cashier of another store uploading a proof here", async () => {
      await assertFails(put(storageAs("cashierB").ref(`paymentProofs/${STORE_A}/proof3.jpg`)));
    });

    it("lets a store manager upload a new local product photo", async () => {
      await assertSucceeds(put(storageAs("managerA").ref(`productPhotos/p1/${STORE_A}/photo2.webp`)));
    });

    it("denies a manager overwriting an existing (possibly promoted) product photo", async () => {
      await assertFails(put(storageAs("managerA").ref(`productPhotos/p1/${STORE_A}/photo1.webp`)));
    });

    it("denies a manager deleting an existing product photo", async () => {
      await assertFails(storageAs("managerA").ref(`productPhotos/p1/${STORE_A}/photo1.webp`).delete());
    });
  });
});
