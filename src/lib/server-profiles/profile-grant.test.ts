import { generateKeyPairSync, sign as nodeSign, type KeyObject } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  issueProfileSession,
  profileGrantSigningKey,
  profileSessionKey,
  verifyProfileSession,
} from "@/lib/server/server-profile-session";
import {
  PINNED_PROFILE_GRANT_KEYS,
  PROFILE_GRANT_ISSUER,
  PROFILE_GRANT_MAX_TTL_MS,
  type GrantPublicKey,
} from "./grant-public-key";
import { verifyGrantLocally } from "./profile-grant";
import { resolveStoredProfile, storesToClearOnContextChange, type RemoteCheck } from "./profile-session";

// Audit F02 / NOV-PROFILE (2026-11-03): ES256 local-profile grants, verified
// by the server (node:crypto) and on the device (WebCrypto) with pinned keys.

const NOW = 1_800_000_000_000;
const subject = { uid: "uid-A", storeId: "store-1", profileId: "prof-1", name: "Ana" };
const expected = { uid: "uid-A", storeId: "store-1", profileId: "prof-1" };

function testKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const pub: GrantPublicKey = { kid, kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
  return { signingKey: { key: privateKey, kid }, pub, pem: privateKey.export({ type: "pkcs8", format: "pem" }) as string };
}

const A = testKey("test-a");
const B = testKey("test-b"); // a second, rotated key
const KEYS = [A.pub, B.pub];

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** Signs arbitrary header/claims with a test key (to build hostile grants). */
function signRaw(header: object, claims: object, key: KeyObject = A.signingKey.key): string {
  const input = `${b64(header)}.${b64(claims)}`;
  const sig = nodeSign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${sig.toString("base64url")}`;
}

const goodClaims = (over: object = {}) => ({
  v: 2,
  iss: PROFILE_GRANT_ISSUER,
  uid: "uid-A",
  sid: "store-1",
  pid: "prof-1",
  nm: "Ana",
  iat: NOW,
  exp: NOW + 3_600_000,
  ...over,
});
const goodHeader = (over: object = {}) => ({ alg: "ES256", typ: "SPG", kid: "test-a", ...over });

function issue(over: { now?: number; ttlMs?: number; signingKey?: typeof A.signingKey } = {}) {
  return issueProfileSession(subject, { now: NOW, signingKey: A.signingKey, ...over })!.token;
}

/** Each hostile case, checked identically by the server and the device. */
async function bothReject(token: string, reason: string, exp = expected, now = NOW) {
  expect(verifyProfileSession(token, exp, { now, publicKeys: KEYS, key: null })).toEqual({ ok: false, reason });
  expect(await verifyGrantLocally(token, exp, { now, publicKeys: KEYS })).toEqual({ ok: false, reason });
}

describe("ES256 grant issue/verify (server + device)", () => {
  it("issues a three-part grant that both sides accept", async () => {
    const token = issue();
    expect(token.split(".")).toHaveLength(3);
    const srv = verifyProfileSession(token, expected, { now: NOW + 1000, publicKeys: KEYS, key: null });
    expect(srv).toMatchObject({ ok: true, payload: { v: 2, uid: "uid-A", sid: "store-1", pid: "prof-1", nm: "Ana", iat: NOW } });
    const dev = await verifyGrantLocally(token, expected, { now: NOW + 1000, publicKeys: KEYS });
    expect(dev).toMatchObject({ ok: true, claims: { pid: "prof-1", nm: "Ana" } });
  });

  it("accepts a grant signed with a rotated (second pinned) key", async () => {
    const token = issue({ signingKey: B.signingKey });
    expect(verifyProfileSession(token, expected, { now: NOW, publicKeys: KEYS, key: null }).ok).toBe(true);
    expect((await verifyGrantLocally(token, expected, { now: NOW, publicKeys: KEYS })).ok).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const [h, , s] = issue().split(".");
    await bothReject(`${h}.${b64(goodClaims({ pid: "prof-boss" }))}.${s}`, "bad-signature", { ...expected, profileId: "prof-boss" });
  });

  it("rejects a fake signature", async () => {
    const [h, c] = issue().split(".");
    await bothReject(`${h}.${c}.fake-signature`, "bad-signature");
    await bothReject(`${h}.${c}.${Buffer.alloc(64, 1).toString("base64url")}`, "bad-signature");
  });

  it("rejects another algorithm in the header (alg confusion / none)", async () => {
    await bothReject(signRaw(goodHeader({ alg: "HS256" }), goodClaims()), "bad-signature");
    await bothReject(signRaw(goodHeader({ alg: "none" }), goodClaims()), "bad-signature");
    await bothReject(signRaw(goodHeader({ typ: "JWT" }), goodClaims()), "bad-signature");
  });

  it("rejects an unknown kid, and a kid that names another pinned key", async () => {
    await bothReject(signRaw(goodHeader({ kid: "nope" }), goodClaims()), "bad-signature");
    await bothReject(signRaw(goodHeader({ kid: "test-b" }), goodClaims()), "bad-signature");
    // A real key that is simply not pinned.
    const rogue = testKey("test-a");
    await bothReject(issue({ signingKey: rogue.signingKey }), "bad-signature");
  });

  it("rejects a wrong issuer and an over-long lifetime even when correctly signed", async () => {
    await bothReject(signRaw(goodHeader(), goodClaims({ iss: "someone-else" })), "malformed");
    await bothReject(signRaw(goodHeader(), goodClaims({ exp: NOW + PROFILE_GRANT_MAX_TTL_MS + 1 })), "malformed");
  });

  it("rejects the wrong account, store and profile", async () => {
    const token = issue();
    await bothReject(token, "wrong-account", { ...expected, uid: "uid-B" });
    await bothReject(token, "wrong-store", { ...expected, storeId: "store-2" });
    await bothReject(token, "wrong-profile", { ...expected, profileId: "prof-2" });
  });

  it("rejects an expired grant", async () => {
    await bothReject(issue({ ttlMs: 1000 }), "expired", expected, NOW + 1000);
  });

  it("caps the issued lifetime at 16 h", () => {
    const r = issueProfileSession(subject, { now: NOW, ttlMs: 7 * 24 * 3_600_000, signingKey: A.signingKey })!;
    expect(r.expiresAt).toBe(NOW + PROFILE_GRANT_MAX_TTL_MS);
  });

  it("rejects garbage", async () => {
    await bothReject("a.b.c", "malformed");
    expect(verifyProfileSession("x".repeat(3000), expected, { now: NOW, publicKeys: KEYS })).toMatchObject({ reason: "malformed" });
  });
});

describe("signing key selection and HMAC fallback", () => {
  const hmacKey = profileSessionKey({ CRON_SECRET: "test-cron-secret" })!;

  it("uses the kid of the pinned key matching the private key", () => {
    expect(profileGrantSigningKey({ SERVER_PROFILE_GRANT_PRIVATE_KEY: A.pem }, KEYS)?.kid).toBe("test-a");
    expect(profileGrantSigningKey({ SERVER_PROFILE_GRANT_PRIVATE_KEY: B.pem.replace(/\n/g, "\\n") }, KEYS)?.kid).toBe("test-b");
  });

  it("refuses a key that is not pinned, not P-256 or missing (never issues unverifiable grants)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(profileGrantSigningKey({ SERVER_PROFILE_GRANT_PRIVATE_KEY: A.pem }, [B.pub])).toBeNull();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    expect(profileGrantSigningKey({ SERVER_PROFILE_GRANT_PRIVATE_KEY: rsa }, KEYS)).toBeNull();
    expect(profileGrantSigningKey({ SERVER_PROFILE_GRANT_PRIVATE_KEY: "not a pem" }, KEYS)).toBeNull();
    expect(profileGrantSigningKey({}, KEYS)).toBeNull();
    // The test pem does not match the production pinned key either.
    expect(profileGrantSigningKey({ SERVER_PROFILE_GRANT_PRIVATE_KEY: A.pem }, PINNED_PROFILE_GRANT_KEYS)).toBeNull();
    err.mockRestore();
  });

  it("falls back to an HMAC token without a signing key, or for old clients", () => {
    const noKey = issueProfileSession(subject, { now: NOW, signingKey: null, key: hmacKey })!;
    expect(noKey.token.split(".")).toHaveLength(2);
    const old = issueProfileSession(subject, { now: NOW, signingKey: A.signingKey, key: hmacKey, format: "hmac" })!;
    expect(old.token.split(".")).toHaveLength(2);
    expect(verifyProfileSession(old.token, expected, { now: NOW, key: hmacKey }).ok).toBe(true);
    expect(issueProfileSession(subject, { now: NOW, signingKey: null, key: null })).toBeNull();
  });

  it("verifies a grant without any HMAC key configured", () => {
    expect(verifyProfileSession(issue(), expected, { now: NOW, publicKeys: KEYS, key: null }).ok).toBe(true);
  });
});

describe("resolveStoredProfile with ES256 grants", () => {
  const base = { uid: "uid-A", storeId: "store-1", now: NOW, publicKeys: KEYS };
  const raw = (token: string, profileId = "prof-1", name = "Ana") =>
    JSON.stringify({ profileId, name, token, expiresAt: NOW + 9e9 });
  const unreachable = async (): Promise<RemoteCheck> => ({ kind: "unreachable" });

  it("restores a legitimate grant offline and on a check-session timeout, using signed claims", async () => {
    const token = issue();
    const verifyRemote = vi.fn();
    const off = await resolveStoredProfile({ ...base, online: false, raw: raw(token, "prof-1", "Edited Boss"), verifyRemote });
    expect(off).toMatchObject({ source: "local-offline", profile: { profileId: "prof-1", name: "Ana", expiresAt: NOW + PROFILE_GRANT_MAX_TTL_MS } });
    expect(verifyRemote).not.toHaveBeenCalled();
    const down = await resolveStoredProfile({ ...base, online: true, raw: raw(token), verifyRemote: unreachable });
    expect(down).toMatchObject({ source: "local-offline", profile: { profileId: "prof-1" } });
  });

  it("rejects body.fake-signature offline and on timeout without asking the server", async () => {
    const [h, c] = issue().split(".");
    for (const online of [false, true]) {
      const verifyRemote = vi.fn(unreachable);
      const r = await resolveStoredProfile({ ...base, online, raw: raw(`${h}.${c}.fake-signature`), verifyRemote });
      expect(r).toEqual({ profile: null, clear: true, reason: "bad-signature" });
      expect(verifyRemote).not.toHaveBeenCalled();
    }
  });

  it("rejects expired, wrong-account, wrong-store and copied-profile grants offline", async () => {
    const off = { ...base, online: false, verifyRemote: vi.fn() };
    expect(await resolveStoredProfile({ ...off, raw: raw(issue({ ttlMs: 1000 })), now: NOW + 1000 })).toMatchObject({ reason: "expired", clear: true });
    expect(await resolveStoredProfile({ ...off, uid: "uid-B", raw: raw(issue()) })).toMatchObject({ reason: "wrong-account", clear: true });
    expect(await resolveStoredProfile({ ...off, storeId: "store-2", raw: raw(issue()) })).toMatchObject({ reason: "wrong-store", clear: true });
    expect(await resolveStoredProfile({ ...off, raw: raw(issue(), "prof-boss") })).toMatchObject({ reason: "wrong-profile", clear: true });
  });

  it("drops a valid grant the server rejects (passcode reset / deleted), e.g. on reconnect", async () => {
    const r = await resolveStoredProfile({
      ...base,
      online: true,
      raw: raw(issue()),
      verifyRemote: async () => ({ kind: "invalid", reason: "Passcode was reset. Sign in again." }),
    });
    expect(r).toEqual({ profile: null, clear: true, reason: "Passcode was reset. Sign in again." });
  });

  it("uses the server's name when online and valid", async () => {
    const r = await resolveStoredProfile({ ...base, online: true, raw: raw(issue()), verifyRemote: async () => ({ kind: "valid", name: "Ana R." }) });
    expect(r).toMatchObject({ source: "server", profile: { name: "Ana R." } });
  });
});

describe("storesToClearOnContextChange (account / store switch)", () => {
  it("clears the store's entry when the Firebase account changes or signs out", () => {
    expect(storesToClearOnContextChange({ storeId: "s1", uid: "A" }, { storeId: "s1", uid: "B" })).toEqual(["s1"]);
    expect(storesToClearOnContextChange({ storeId: "s1", uid: "A" }, { storeId: "s1", uid: null })).toEqual(["s1"]);
  });

  it("clears the previous store's entry on a store switch", () => {
    expect(storesToClearOnContextChange({ storeId: "s1", uid: "A" }, { storeId: "s2", uid: "A" })).toEqual(["s1"]);
    expect(storesToClearOnContextChange({ storeId: "s1", uid: "A" }, { storeId: null, uid: "A" })).toEqual(["s1"]);
  });

  it("clears both on a combined switch, and nothing on first load or no change", () => {
    expect(storesToClearOnContextChange({ storeId: "s1", uid: "A" }, { storeId: "s2", uid: "B" }).sort()).toEqual(["s1", "s2"]);
    expect(storesToClearOnContextChange(null, { storeId: "s1", uid: "A" })).toEqual([]);
    expect(storesToClearOnContextChange({ storeId: "s1", uid: "A" }, { storeId: "s1", uid: "A" })).toEqual([]);
    expect(storesToClearOnContextChange({ storeId: "s1", uid: null }, { storeId: "s1", uid: "A" })).toEqual([]);
  });
});
