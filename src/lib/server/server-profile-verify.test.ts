import { FieldValue } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  hashPasscodeLegacy,
  hashPasscodeScrypt,
  verifyProfilePasscodeAtomic,
} from "@/lib/server/server-profile-secrets";

/**
 * Audit B21: lockout counting must be atomic. The fake below mimics the Admin
 * SDK's server-side transactions (pessimistic locks => concurrent
 * transactions serialize; writes apply at commit). With the old read-then-write
 * outside a transaction, N parallel wrong guesses all read failedAttempts=0
 * and recorded one failure.
 */

type Doc = Record<string, unknown>;

function makeFakeDb() {
  const store = new Map<string, Doc>();
  let chain: Promise<unknown> = Promise.resolve();
  let txCount = 0;

  const applyWrite = (path: string, data: Doc, merge: boolean, mustExist: boolean) => {
    const prev = store.get(path);
    if (mustExist && !prev) throw new Error(`NOT_FOUND: ${path}`);
    const next: Doc = merge || mustExist ? { ...(prev ?? {}) } : {};
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof FieldValue) {
        if (v.isEqual(FieldValue.delete())) delete next[k];
        else next[k] = "SERVER_TS";
      } else {
        next[k] = v;
      }
    }
    store.set(path, next);
  };

  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const run = async () => {
        txCount += 1;
        const writes: Array<() => void> = [];
        const tx = {
          get: async (ref: { path: string }) => {
            // Yield so un-serialized code would interleave here.
            await new Promise((r) => setTimeout(r, 1));
            const d = store.get(ref.path);
            return { exists: !!d, data: () => (d ? { ...d } : undefined) };
          },
          set: (ref: { path: string }, data: Doc, opts?: { merge?: boolean }) =>
            writes.push(() => applyWrite(ref.path, data, !!opts?.merge, false)),
          update: (ref: { path: string }, data: Doc) => writes.push(() => applyWrite(ref.path, data, true, true)),
        };
        const result = await fn(tx);
        writes.forEach((w) => w());
        return result;
      };
      const p = chain.then(run, run);
      chain = p.catch(() => undefined);
      return p;
    },
  };
  return { db: db as any, store, txCount: () => txCount };
}

const STORE = "storeA";
const PROFILE = "p1";
const pPath = `stores/${STORE}/serverProfiles/${PROFILE}`;
const sPath = `stores/${STORE}/serverProfileSecrets/${PROFILE}`;
const NOW = 1_800_000_000_000;

let fake: ReturnType<typeof makeFakeDb>;

beforeEach(() => {
  fake = makeFakeDb();
  fake.store.set(pPath, { id: PROFILE, name: "Ana" });
  fake.store.set(sPath, { profileId: PROFILE, ...hashPasscodeScrypt("123456"), failedAttempts: 0, lockedUntilMs: 0 });
});

describe("verifyProfilePasscodeAtomic", () => {
  it("accepts the right passcode and clears the counter", async () => {
    fake.store.set(sPath, { ...fake.store.get(sPath)!, failedAttempts: 3 });
    const out = await verifyProfilePasscodeAtomic(fake.db, STORE, PROFILE, "123456", NOW);
    expect(out).toEqual({ kind: "ok", name: "Ana" });
    expect(fake.store.get(sPath)!.failedAttempts).toBe(0);
    expect(fake.store.get(pPath)!.lastLoginAt).toBe("SERVER_TS");
  });

  it("simultaneous wrong guesses each count, and the rest hit the lockout", async () => {
    const attempts = 12;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        verifyProfilePasscodeAtomic(fake.db, STORE, PROFILE, String(100000 + i), NOW)
      )
    );
    const wrong = results.filter((r) => r.kind === "wrong").length;
    const locked = results.filter((r) => r.kind === "locked").length;
    expect(wrong).toBe(MAX_FAILED_ATTEMPTS);
    expect(locked).toBe(attempts - MAX_FAILED_ATTEMPTS);
    const secret = fake.store.get(sPath)!;
    expect(secret.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(secret.lockedUntilMs).toBe(NOW + LOCKOUT_MS);
  });

  it("refuses even the right passcode while locked", async () => {
    fake.store.set(sPath, { ...fake.store.get(sPath)!, lockedUntilMs: NOW + 60_000 });
    const out = await verifyProfilePasscodeAtomic(fake.db, STORE, PROFILE, "123456", NOW);
    expect(out).toEqual({ kind: "locked", minutes: 1 });
  });

  it("rejects a non-six-digit passcode without a transaction or a counted attempt", async () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12345a"]) {
      expect(await verifyProfilePasscodeAtomic(fake.db, STORE, PROFILE, bad, NOW)).toEqual({ kind: "wrong" });
    }
    expect(fake.txCount()).toBe(0);
    expect(fake.store.get(sPath)!.failedAttempts).toBe(0);
  });

  it("returns not-found for a missing profile or a path-like id", async () => {
    expect(await verifyProfilePasscodeAtomic(fake.db, STORE, "nope", "123456", NOW)).toEqual({ kind: "not-found" });
    expect(await verifyProfilePasscodeAtomic(fake.db, STORE, "a/b", "123456", NOW)).toEqual({ kind: "not-found" });
  });

  it("returns no-secret when neither a secret nor a legacy hash exists", async () => {
    fake.store.delete(sPath);
    expect(await verifyProfilePasscodeAtomic(fake.db, STORE, PROFILE, "123456", NOW)).toEqual({ kind: "no-secret" });
  });

  it("upgrades a legacy hash on success and drops the readable copy", async () => {
    fake.store.delete(sPath);
    fake.store.set(pPath, { id: PROFILE, name: "Ana", passcodeHash: hashPasscodeLegacy(STORE, "654321") });
    const out = await verifyProfilePasscodeAtomic(fake.db, STORE, PROFILE, "654321", NOW);
    expect(out.kind).toBe("ok");
    expect(fake.store.get(sPath)!.algo).toBe("scrypt");
    expect(fake.store.get(pPath)!.passcodeHash).toBeUndefined();
  });

  it("a failed legacy attempt preserves the legacy hash in the secret doc", async () => {
    fake.store.delete(sPath);
    const legacy = hashPasscodeLegacy(STORE, "654321");
    fake.store.set(pPath, { id: PROFILE, name: "Ana", passcodeHash: legacy });
    expect((await verifyProfilePasscodeAtomic(fake.db, STORE, PROFILE, "000000", NOW)).kind).toBe("wrong");
    expect(fake.store.get(sPath)).toMatchObject({ algo: "sha256-legacy", hash: legacy, failedAttempts: 1 });
  });
});
