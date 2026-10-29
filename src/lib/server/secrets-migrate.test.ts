import { FieldValue } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import {
  customerSecretPath,
  legacyPasswordFieldEnabled,
  writeCustomerPasswordHash,
} from "@/lib/server/customer-secrets";
import { migrateCustomerSecrets } from "@/lib/server/customer-secrets-migrate";
import { migrateServerProfileSecretsForStore } from "@/lib/server/server-profile-secrets-migrate";
import {
  hashPasscodeLegacy,
  hashPasscodeScrypt,
  secretDocRequired,
  verifyProfilePasscodeAtomic,
} from "@/lib/server/server-profile-secrets";

/**
 * Audit B05 (customer password hash → customers/{phone}/secrets/auth) and
 * B20 (serverProfiles.passcodeHash → serverProfileSecrets, then fail closed).
 * Minimal in-memory Admin-SDK fake: doc get, collection get with
 * orderBy/limit/startAfter by id, batches and transactions (writes at commit).
 */

type Doc = Record<string, unknown>;

function makeFakeDb() {
  const store = new Map<string, Doc>();
  let writes = 0;

  const apply = (path: string, data: Doc, mode: "set" | "merge" | "update") => {
    const prev = store.get(path);
    if (mode === "update" && !prev) throw new Error(`NOT_FOUND: ${path}`);
    const next: Doc = mode === "set" ? {} : { ...(prev ?? {}) };
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof FieldValue) {
        if (v.isEqual(FieldValue.delete())) delete next[k];
        else next[k] = "SERVER_TS";
      } else next[k] = v;
    }
    writes += 1;
    store.set(path, next);
  };
  const snap = (path: string) => {
    const d = store.get(path);
    return { id: path.split("/").pop()!, exists: !!d, data: () => (d ? { ...d } : undefined) };
  };
  const query = (coll: string, startAfter: string | null, lim: number | null): any => ({
    orderBy: () => query(coll, startAfter, lim),
    limit: (n: number) => query(coll, startAfter, n),
    startAfter: (id: string) => query(coll, id, lim),
    get: async () => {
      const depth = coll.split("/").length + 1;
      let ids = [...store.keys()]
        .filter((p) => p.startsWith(coll + "/") && p.split("/").length === depth)
        .map((p) => p.split("/").pop()!)
        .sort();
      if (startAfter) ids = ids.filter((id) => id > startAfter);
      if (lim) ids = ids.slice(0, lim);
      const docs = ids.map((id) => snap(`${coll}/${id}`));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  });
  const writer = (queue: Array<() => void>) => ({
    set: (ref: { path: string }, data: Doc, opts?: { merge?: boolean }) =>
      queue.push(() => apply(ref.path, data, opts?.merge ? "merge" : "set")),
    update: (ref: { path: string }, data: Doc) => queue.push(() => apply(ref.path, data, "update")),
  });

  const db = {
    doc: (path: string) => ({ path, get: async () => snap(path) }),
    collection: (path: string) => query(path, null, null),
    batch: () => {
      const q: Array<() => void> = [];
      return { ...writer(q), commit: async () => q.forEach((w) => w()) };
    },
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const q: Array<() => void> = [];
      const tx = { get: async (ref: { path: string }) => snap(ref.path), ...writer(q) };
      const out = await fn(tx);
      q.forEach((w) => w());
      return out;
    },
  };
  return { db: db as any, store, writes: () => writes };
}

let fake: ReturnType<typeof makeFakeDb>;
beforeEach(() => {
  fake = makeFakeDb();
});

// ---------------------------------------------------------------- B05 -------

describe("writeCustomerPasswordHash (reset-password dual-write)", () => {
  const P = "+639171234567";
  beforeEach(() => fake.store.set(`customers/${P}`, { name: "Ana", passwordHash: "old" }));

  it("default: writes the secret doc AND the legacy field together", async () => {
    await writeCustomerPasswordHash(fake.db, P, "new", { passwordResetByUid: "m1" }, {});
    expect(fake.store.get(customerSecretPath(P))).toMatchObject({ passwordHash: "new" });
    expect(fake.store.get(`customers/${P}`)).toMatchObject({ passwordHash: "new", passwordResetByUid: "m1", name: "Ana" });
  });

  it("CUSTOMER_SECRETS_LEGACY_FIELD=off: secret only, legacy field deleted", async () => {
    await writeCustomerPasswordHash(fake.db, P, "new", {}, { CUSTOMER_SECRETS_LEGACY_FIELD: "off" });
    expect(fake.store.get(customerSecretPath(P))).toMatchObject({ passwordHash: "new" });
    expect(fake.store.get(`customers/${P}`)!.passwordHash).toBeUndefined();
  });

  it("flag defaults on for anything but 'off'", () => {
    expect(legacyPasswordFieldEnabled({})).toBe(true);
    expect(legacyPasswordFieldEnabled({ CUSTOMER_SECRETS_LEGACY_FIELD: "on" })).toBe(true);
    expect(legacyPasswordFieldEnabled({ CUSTOMER_SECRETS_LEGACY_FIELD: " OFF " })).toBe(false);
  });
});

describe("migrateCustomerSecrets", () => {
  beforeEach(() => {
    fake.store.set("customers/+631", { passwordHash: "h1", name: "A" });
    fake.store.set("customers/+632", { passwordHash: "h2" });
    fake.store.set(customerSecretPath("+632"), { passwordHash: "h2" }); // already copied
    fake.store.set("customers/+633", { name: "no password" });
    fake.store.set("customers/+634", { passwordHash: "legacy4" });
    fake.store.set(customerSecretPath("+634"), { passwordHash: "different4" });
    fake.store.set("customers/+631/pointsLedger/l1", { points: 1 }); // must not be scanned as a customer
  });

  it("dry run writes nothing and reports the plan", async () => {
    const before = fake.writes();
    const r = await migrateCustomerSecrets(fake.db, { commit: false, removeLegacy: false });
    expect(fake.writes()).toBe(before);
    expect(r.scanned).toBe(4);
    expect(r.counts).toMatchObject({ copy: 2, "in-sync": 1, "no-hash": 1 });
  });

  it("phase 1 copies (legacy wins while dual-writing) and keeps the legacy field", async () => {
    const r = await migrateCustomerSecrets(fake.db, { commit: true, removeLegacy: false });
    expect(r.counts).toMatchObject({ copy: 2, "in-sync": 1, "no-hash": 1 });
    expect(fake.store.get(customerSecretPath("+631"))!.passwordHash).toBe("h1");
    expect(fake.store.get(customerSecretPath("+634"))!.passwordHash).toBe("legacy4");
    expect(fake.store.get("customers/+631")!.passwordHash).toBe("h1");
    expect(fake.store.has(customerSecretPath("+633"))).toBe(false);
    // idempotent
    const again = await migrateCustomerSecrets(fake.db, { commit: true, removeLegacy: false });
    expect(again.counts).toMatchObject({ copy: 0, "in-sync": 3 });
  });

  it("phase 2 strips matching hashes, copies missing ones, and leaves conflicts alone", async () => {
    const r = await migrateCustomerSecrets(fake.db, { commit: true, removeLegacy: true });
    expect(r.counts).toMatchObject({ "copy-and-strip": 1, strip: 1, conflict: 1, "no-hash": 1 });
    expect(r.conflicts).toEqual(["+634"]);
    expect(fake.store.get("customers/+631")!.passwordHash).toBeUndefined();
    expect(fake.store.get(customerSecretPath("+631"))!.passwordHash).toBe("h1");
    expect(fake.store.get("customers/+632")!.passwordHash).toBeUndefined();
    expect(fake.store.get("customers/+634")!.passwordHash).toBe("legacy4");
    expect(fake.store.get(customerSecretPath("+634"))!.passwordHash).toBe("different4");
  });
});

// ---------------------------------------------------------------- B20 -------

describe("migrateServerProfileSecretsForStore", () => {
  const S = "storeA";
  const legacy = hashPasscodeLegacy(S, "654321");
  beforeEach(() => {
    fake.store.set(`stores/${S}/serverProfiles/p1`, { name: "Legacy", passcodeHash: legacy });
    fake.store.set(`stores/${S}/serverProfiles/p2`, { name: "Both", passcodeHash: "stale" });
    fake.store.set(`stores/${S}/serverProfileSecrets/p2`, { profileId: "p2", ...hashPasscodeScrypt("111111") });
    fake.store.set(`stores/${S}/serverProfiles/p3`, { name: "Done" });
    fake.store.set(`stores/${S}/serverProfileSecrets/p3`, { profileId: "p3", ...hashPasscodeScrypt("222222") });
    fake.store.set(`stores/${S}/serverProfiles/p4`, { name: "Nothing" });
  });

  it("dry run writes nothing", async () => {
    const before = fake.writes();
    const r = await migrateServerProfileSecretsForStore(fake.db, S, { commit: false });
    expect(fake.writes()).toBe(before);
    expect(r.actions).toEqual({ "copy-and-strip": ["p1"], "strip-only": ["p2"], "already-migrated": ["p3"], "no-secret": ["p4"] });
  });

  it("commit moves the legacy hash, strips readable copies, never overwrites an existing secret", async () => {
    const p2Secret = { ...fake.store.get(`stores/${S}/serverProfileSecrets/p2`)! };
    await migrateServerProfileSecretsForStore(fake.db, S, { commit: true });
    expect(fake.store.get(`stores/${S}/serverProfileSecrets/p1`)).toMatchObject({ algo: "sha256-legacy", hash: legacy, failedAttempts: 0 });
    expect(fake.store.get(`stores/${S}/serverProfiles/p1`)!.passcodeHash).toBeUndefined();
    expect(fake.store.get(`stores/${S}/serverProfiles/p2`)!.passcodeHash).toBeUndefined();
    expect(fake.store.get(`stores/${S}/serverProfileSecrets/p2`)).toMatchObject({ hash: p2Secret.hash, salt: p2Secret.salt });
    const again = await migrateServerProfileSecretsForStore(fake.db, S, { commit: true });
    expect(again.actions["copy-and-strip"]).toEqual([]);
    expect(again.actions["strip-only"]).toEqual([]);
  });

  it("a migrated legacy profile still signs in with its old passcode under the fail-closed flag", async () => {
    await migrateServerProfileSecretsForStore(fake.db, S, { commit: true });
    const out = await verifyProfilePasscodeAtomic(fake.db, S, "p1", "654321", Date.now(), true);
    expect(out).toEqual({ kind: "ok", name: "Legacy" });
  });
});

describe("SERVER_PROFILE_REQUIRE_SECRET_DOC (fail closed)", () => {
  const S = "storeA";
  beforeEach(() => {
    // Unmigrated (or forged) legacy hash on the profile doc, no secret doc.
    fake.store.set(`stores/${S}/serverProfiles/p1`, { name: "Ana", passcodeHash: hashPasscodeLegacy(S, "654321") });
  });

  it("flag off (default): legacy fallback still authenticates", async () => {
    expect(secretDocRequired({})).toBe(false);
    const out = await verifyProfilePasscodeAtomic(fake.db, S, "p1", "654321", Date.now(), false);
    expect(out.kind).toBe("ok");
  });

  it("flag on: no secret doc means no sign-in, and nothing is written", async () => {
    expect(secretDocRequired({ SERVER_PROFILE_REQUIRE_SECRET_DOC: "true" })).toBe(true);
    const before = fake.writes();
    const out = await verifyProfilePasscodeAtomic(fake.db, S, "p1", "654321", Date.now(), true);
    expect(out).toEqual({ kind: "no-secret" });
    expect(fake.writes()).toBe(before);
    expect(fake.store.has(`stores/${S}/serverProfileSecrets/p1`)).toBe(false);
  });
});
