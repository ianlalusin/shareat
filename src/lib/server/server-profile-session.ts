import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import {
  PINNED_PROFILE_GRANT_KEYS,
  PROFILE_GRANT_ALG,
  PROFILE_GRANT_ISSUER,
  PROFILE_GRANT_MAX_TTL_MS,
  PROFILE_GRANT_TYP,
  type GrantPublicKey,
} from "@/lib/server-profiles/grant-public-key";
import { checkGrantClaims, parseGrant, selectGrantKey, type GrantClaims } from "@/lib/server-profiles/profile-grant";

/**
 * Signed local-profile sessions (audit F02, 2026-10-30).
 *
 * A successful passcode verify used to return only `{ id, name }`, and the
 * client stored that in localStorage and trusted it on every reload. Anyone
 * with the device could edit that entry and become any operator without a
 * passcode, and the entry survived a switch to another Firebase account.
 *
 * Now the server returns a token bound to (Firebase uid, storeId, profileId)
 * with an expiry, signed with HMAC-SHA256. The client checks uid/store/expiry
 * locally and asks /api/server-profiles {op:"check-session"} to verify the
 * signature (and that the profile still exists) when it rehydrates.
 *
 * Key: SERVER_PROFILE_SESSION_SECRET if set; otherwise derived from the
 * already-deployed CRON_SECRET (then CUSTOMER_JOIN_TOKEN_SECRET). The derived
 * key is an HMAC of the base secret with a fixed label, so a session token can
 * never be used as, or reveal, the cron bearer secret. With no secret at all,
 * no token is issued and the client keeps the profile for the tab only.
 *
 * ES256 grants (audit F02 / NOV-PROFILE, 2026-11-03). The HMAC token above can
 * only be checked by the server, so an offline or timed-out device used to
 * restore a profile from its unverified claims — `body.fake-signature` worked.
 * When SERVER_PROFILE_GRANT_PRIVATE_KEY (PKCS8 PEM, P-256) is set, the server
 * issues a three-part ES256 grant (format in profile-grant.ts) that devices
 * verify locally against the public keys pinned in grant-public-key.ts.
 * Without that key the server keeps issuing HMAC tokens, which new clients
 * restore ONLY after a successful online check-session (no offline restore).
 * Old APKs, which do not send `grantFormat: "es256"`, keep receiving HMAC
 * tokens so they are not logged out on every reload.
 *
 * REMOVAL NOTE (HMAC v1): once the private key secret is live and every device
 * runs an APK that sends grantFormat "es256", drop the v1 branches of
 * issue/verify and profileSessionKey. Outstanding v1 tokens die within
 * PROFILE_SESSION_TTL_MS (16 h) of the last one issued.
 */

export const PROFILE_SESSION_TTL_MS = PROFILE_GRANT_MAX_TTL_MS; // one long shift (16 h)
const KEY_LABEL = "shareat:server-profile-session:v1";

export type ProfileSessionPayload = {
  v: 1 | 2; // 1 = HMAC session (legacy), 2 = ES256 grant
  uid: string;
  sid: string; // storeId
  pid: string; // profileId
  iat: number; // ms
  exp: number; // ms
  iss?: string; // v2 only
  nm?: string; // v2 only: profile name at issue time
};

export type ProfileSessionCheck =
  | { ok: true; payload: ProfileSessionPayload }
  | {
      ok: false;
      reason: "no-key" | "malformed" | "bad-signature" | "wrong-account" | "wrong-store" | "wrong-profile" | "expired";
    };

export function profileSessionKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const base =
    env.SERVER_PROFILE_SESSION_SECRET?.trim() ||
    env.CRON_SECRET?.trim() ||
    env.CUSTOMER_JOIN_TOKEN_SECRET?.trim();
  if (!base) return null;
  return createHmac("sha256", base).update(KEY_LABEL).digest();
}

function sign(key: Buffer, body: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export type GrantSigningKey = { key: KeyObject; kid: string };

let grantKeyCache: { pem: string; value: GrantSigningKey | null } | null = null;

/**
 * The ES256 signing key from SERVER_PROFILE_GRANT_PRIVATE_KEY, with the kid of
 * the pinned public key it matches. null (and one console error) when the key
 * is missing, not P-256, or matches no pinned key: a grant that devices
 * cannot verify must never be issued.
 */
export function profileGrantSigningKey(
  env: Record<string, string | undefined> = process.env,
  pinned: readonly GrantPublicKey[] = PINNED_PROFILE_GRANT_KEYS
): GrantSigningKey | null {
  // Secret values pasted on one line sometimes carry literal "\n".
  const pem = env.SERVER_PROFILE_GRANT_PRIVATE_KEY?.trim().replace(/\\n/g, "\n");
  if (!pem) return null;
  const cacheable = pinned === PINNED_PROFILE_GRANT_KEYS;
  if (cacheable && grantKeyCache?.pem === pem) return grantKeyCache.value;
  let value: GrantSigningKey | null = null;
  try {
    const key = createPrivateKey({ key: pem, format: "pem" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new Error("not an EC P-256 key");
    }
    const pub = createPublicKey(key).export({ format: "jwk" }) as { x?: string; y?: string };
    const match = pinned.find((k) => k.x === pub.x && k.y === pub.y);
    if (!match) throw new Error("its public key is not pinned in grant-public-key.ts");
    value = { key, kid: match.kid };
  } catch (e: any) {
    console.error(`[server-profile-session] SERVER_PROFILE_GRANT_PRIVATE_KEY unusable: ${e?.message ?? e}`);
  }
  if (cacheable) grantKeyCache = { pem, value };
  return value;
}

function b64urlJson(o: unknown): string {
  return Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
}

/**
 * Issues a profile session: an ES256 grant when a signing key is available
 * and the caller did not ask for the legacy format, otherwise the HMAC token,
 * null when neither key exists. Lifetime is capped at 16 h.
 */
export function issueProfileSession(
  subject: { uid: string; storeId: string; profileId: string; name?: string },
  opts: {
    now?: number;
    ttlMs?: number;
    key?: Buffer | null;
    /** "hmac" for clients that cannot read ES256 grants (old APKs). */
    format?: "es256" | "hmac";
    signingKey?: GrantSigningKey | null;
  } = {}
): { token: string; expiresAt: number } | null {
  const now = opts.now ?? Date.now();
  const ttl = Math.min(opts.ttlMs ?? PROFILE_SESSION_TTL_MS, PROFILE_GRANT_MAX_TTL_MS);

  if (opts.format !== "hmac") {
    const signing = opts.signingKey === undefined ? profileGrantSigningKey() : opts.signingKey;
    if (signing) {
      const claims: GrantClaims = {
        v: 2,
        iss: PROFILE_GRANT_ISSUER,
        uid: subject.uid,
        sid: subject.storeId,
        pid: subject.profileId,
        ...(subject.name ? { nm: subject.name } : {}),
        iat: now,
        exp: now + ttl,
      };
      const input = `${b64urlJson({ alg: PROFILE_GRANT_ALG, typ: PROFILE_GRANT_TYP, kid: signing.kid })}.${b64urlJson(claims)}`;
      const sig = cryptoSign("sha256", Buffer.from(input, "utf8"), { key: signing.key, dsaEncoding: "ieee-p1363" });
      return { token: `${input}.${sig.toString("base64url")}`, expiresAt: claims.exp };
    }
  }

  // Legacy HMAC v1 (see REMOVAL NOTE above).
  const key = opts.key === undefined ? profileSessionKey() : opts.key;
  if (!key) return null;
  const payload: ProfileSessionPayload = {
    v: 1,
    uid: subject.uid,
    sid: subject.storeId,
    pid: subject.profileId,
    iat: now,
    exp: now + ttl,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${body}.${sign(key, body)}`, expiresAt: payload.exp };
}

const publicKeyCache = new Map<string, KeyObject>();
function publicKeyObject(jwk: GrantPublicKey): KeyObject {
  const cacheKey = `${jwk.kid}|${jwk.x}|${jwk.y}`;
  let k = publicKeyCache.get(cacheKey);
  if (!k) {
    k = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" });
    publicKeyCache.set(cacheKey, k);
  }
  return k;
}

function verifyGrant(
  token: string,
  expected: { uid: string; storeId: string; profileId?: string },
  now: number,
  keys: readonly GrantPublicKey[]
): ProfileSessionCheck {
  const parsed = parseGrant(token);
  if (!parsed) return { ok: false, reason: "malformed" };
  const jwk = selectGrantKey(parsed.header, keys);
  if (!jwk || parsed.signature.length !== 64) return { ok: false, reason: "bad-signature" };
  let valid = false;
  try {
    valid = cryptoVerify(
      "sha256",
      Buffer.from(parsed.signingInput, "utf8"),
      { key: publicKeyObject(jwk), dsaEncoding: "ieee-p1363" },
      parsed.signature
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad-signature" };
  const failure = checkGrantClaims(parsed.claims, expected, now);
  if (failure) return { ok: false, reason: failure };
  const c = parsed.claims;
  return {
    ok: true,
    payload: { v: 2, uid: c.uid, sid: c.sid, pid: c.pid, iat: c.iat, exp: c.exp, iss: c.iss, ...(c.nm ? { nm: c.nm } : {}) },
  };
}

/**
 * Frozen contract (P1 codes against it): verifies an ES256 grant (three parts)
 * or, during the transition, a legacy HMAC v1 token (two parts).
 */
export function verifyProfileSession(
  token: unknown,
  expected: { uid: string; storeId: string; profileId?: string },
  opts: { now?: number; key?: Buffer | null; publicKeys?: readonly GrantPublicKey[] } = {}
): ProfileSessionCheck {
  if (typeof token !== "string" || token.length > 2048) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length === 3) {
    return verifyGrant(token, expected, opts.now ?? Date.now(), opts.publicKeys ?? PINNED_PROFILE_GRANT_KEYS);
  }

  // Legacy HMAC v1 (see REMOVAL NOTE above).
  const key = opts.key === undefined ? profileSessionKey() : opts.key;
  if (!key) return { ok: false, reason: "no-key" };
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, mac] = parts;

  const want = Buffer.from(sign(key, body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "bad-signature" };

  let payload: ProfileSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !payload ||
    payload.v !== 1 ||
    typeof payload.uid !== "string" ||
    typeof payload.sid !== "string" ||
    typeof payload.pid !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.iat !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (payload.uid !== expected.uid) return { ok: false, reason: "wrong-account" };
  if (payload.sid !== expected.storeId) return { ok: false, reason: "wrong-store" };
  if (expected.profileId !== undefined && payload.pid !== expected.profileId) return { ok: false, reason: "wrong-profile" };
  if (payload.exp <= (opts.now ?? Date.now())) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
