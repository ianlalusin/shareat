import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/**
 * TV ads (CUSTOMER /admin/tv-ads → SharEat Ads TV app): only platform admins
 * may change `tvAds` and upload to `tvAds/` in Storage. TVs never touch
 * Firestore; they read /api/external/tv-ads and download by tokened URL.
 */

const hasStorageEmulator = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const STAFF = {
  admin: { role: "admin", status: "active", assignedStoreIds: [] },
  manager: { role: "manager", status: "active", assignedStoreIds: ["lipa"] },
} as const;

let testEnv: RulesTestEnvironment;

const as = (who: keyof typeof STAFF | "anon") =>
  who === "anon" ? testEnv.unauthenticatedContext() : testEnv.authenticatedContext(`u_${who}`);
// One Firestore per user per test: calling .firestore() twice on a context re-applies settings and throws.
let dbs: Record<string, Firestore> = {};
const dbAs = (who: keyof typeof STAFF | "anon") =>
  (dbs[who] ??= as(who).firestore() as unknown as Firestore);
const put = (who: keyof typeof STAFF | "anon", path: string, contentType: string, size = BYTES.length) =>
  Promise.resolve(as(who).storage().ref(path).put(size === BYTES.length ? BYTES : new Uint8Array(size), { contentType }));

describe.skipIf(!hasStorageEmulator)("tv ads rules", () => {
  beforeAll(async () => {
    const [sHost, sPort] = String(process.env.FIREBASE_STORAGE_EMULATOR_HOST).split(":");
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pos",
      firestore: { rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
      storage: { rules: readFileSync(resolve(__dirname, "../../storage.rules"), "utf8"), host: sHost || "127.0.0.1", port: Number(sPort) || 9199 },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    dbs = {};
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const [who, d] of Object.entries(STAFF)) await db.doc(`staff/u_${who}`).set({ name: who, ...d });
      await db.doc("tvAds/a1").set({ active: true, url: "https://x", storeIds: "all" });
    });
  });

  it("admin can read and write tvAds", async () => {
    await assertSucceeds(getDoc(doc(dbAs("admin"), "tvAds/a1")));
    await assertSucceeds(setDoc(doc(dbAs("admin"), "tvAds/a2"), { active: true }));
  });

  // Staff can READ via the house catch-all (/{collection}/{docId}); ad URLs are not secret.
  it("manager cannot write tvAds; anonymous cannot read", async () => {
    await assertFails(setDoc(doc(dbAs("manager"), "tvAds/a2"), { active: true }));
    await assertFails(getDoc(doc(dbAs("anon"), "tvAds/a1")));
  });

  it("admin can upload a picture or an mp4; manager cannot", async () => {
    await assertSucceeds(put("admin", "tvAds/a1/p.png", "image/png"));
    await assertSucceeds(put("admin", "tvAds/a1/v.mp4", "video/mp4"));
    await assertFails(put("manager", "tvAds/a1/p.png", "image/png"));
  });

  it("rejects other file types and pictures over 10 MB", async () => {
    await assertFails(put("admin", "tvAds/a1/x.pdf", "application/pdf"));
    await assertFails(put("admin", "tvAds/a1/big.png", "image/png", 11 * 1024 * 1024));
  });
});
