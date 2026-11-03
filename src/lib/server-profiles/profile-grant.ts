import {
  PINNED_PROFILE_GRANT_KEYS,
  PROFILE_GRANT_ALG,
  PROFILE_GRANT_ISSUER,
  PROFILE_GRANT_MAX_TTL_MS,
  PROFILE_GRANT_TYP,
  type GrantPublicKey,
} from "./grant-public-key";

/**
 * ES256 local-profile grant format, shared by server and client (audit F02).
 *
 *   base64url(header) "." base64url(claims) "." base64url(r||s)
 *   header = { alg: "ES256", typ: "SPG", kid }
 *   claims = { v: 2, iss, uid, sid, pid, nm?, iat, exp }   (times in ms)
 *
 * The signature is ECDSA P-256 / SHA-256 over the ASCII "header.claims", in
 * the 64-byte IEEE P1363 form WebCrypto uses. A two-part token is the older
 * HMAC session, which only the server can check.
 *
 * No Node imports: the client verifies with WebCrypto (crypto.subtle).
 */

export interface GrantHeader {
  alg: string;
  typ?: string;
  kid: string;
}

export interface GrantClaims {
  v: 2;
  iss: string;
  uid: string;
  sid: string;
  pid: string;
  nm?: string;
  iat: number;
  exp: number;
}

export type GrantFailure =
  | "malformed"
  | "bad-signature"
  | "wrong-account"
  | "wrong-store"
  | "wrong-profile"
  | "expired";

export interface ParsedGrant {
  header: GrantHeader;
  claims: GrantClaims;
  signingInput: string;
  signature: Uint8Array;
}

export function base64UrlToBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function decodeJson(s: string): any {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(s)));
}

/** True when the token has the three-part ES256 grant shape. */
export function isGrantToken(token: unknown): token is string {
  return typeof token === "string" && token.split(".").length === 3;
}

/**
 * Splits and decodes a grant WITHOUT checking the signature. Returns null for
 * anything that is not a structurally valid v2 grant.
 */
export function parseGrant(token: unknown): ParsedGrant | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  try {
    const header = decodeJson(parts[0]);
    const claims = decodeJson(parts[1]);
    const signature = base64UrlToBytes(parts[2]);
    if (!header || typeof header.alg !== "string" || typeof header.kid !== "string") return null;
    if (
      !claims ||
      claims.v !== 2 ||
      typeof claims.iss !== "string" ||
      typeof claims.uid !== "string" ||
      typeof claims.sid !== "string" ||
      typeof claims.pid !== "string" ||
      (claims.nm !== undefined && typeof claims.nm !== "string") ||
      !Number.isFinite(claims.iat) ||
      !Number.isFinite(claims.exp)
    ) {
      return null;
    }
    return { header, claims, signingInput: `${parts[0]}.${parts[1]}`, signature };
  } catch {
    return null;
  }
}

/**
 * The key a grant claims to be signed with, or null when its header names a
 * different algorithm/type or an unknown kid (never fall back to another key).
 */
export function selectGrantKey(
  header: GrantHeader,
  keys: readonly GrantPublicKey[] = PINNED_PROFILE_GRANT_KEYS
): GrantPublicKey | null {
  if (header.alg !== PROFILE_GRANT_ALG) return null;
  if (header.typ !== undefined && header.typ !== PROFILE_GRANT_TYP) return null;
  return keys.find((k) => k.kid === header.kid) ?? null;
}

/** Issuer, lifetime, subject and expiry checks — run only AFTER the signature verified. */
export function checkGrantClaims(
  claims: GrantClaims,
  expected: { uid: string; storeId: string; profileId?: string },
  now: number
): GrantFailure | null {
  if (claims.iss !== PROFILE_GRANT_ISSUER) return "malformed";
  if (claims.exp - claims.iat > PROFILE_GRANT_MAX_TTL_MS || claims.exp <= claims.iat) return "malformed";
  if (claims.uid !== expected.uid) return "wrong-account";
  if (claims.sid !== expected.storeId) return "wrong-store";
  if (expected.profileId !== undefined && claims.pid !== expected.profileId) return "wrong-profile";
  if (claims.exp <= now) return "expired";
  return null;
}

export type LocalGrantCheck =
  | { ok: true; claims: GrantClaims }
  | { ok: false; reason: GrantFailure | "not-a-grant" | "no-crypto" };

/**
 * Full local verification with WebCrypto: shape, alg, pinned kid, ECDSA
 * signature, then issuer/lifetime/uid/store/profile/expiry.
 */
export async function verifyGrantLocally(
  token: unknown,
  expected: { uid: string; storeId: string; profileId?: string },
  opts: { now: number; publicKeys?: readonly GrantPublicKey[] }
): Promise<LocalGrantCheck> {
  if (!isGrantToken(token)) return { ok: false, reason: "not-a-grant" };
  const parsed = parseGrant(token);
  if (!parsed) return { ok: false, reason: "malformed" };
  const jwk = selectGrantKey(parsed.header, opts.publicKeys);
  if (!jwk) return { ok: false, reason: "bad-signature" };
  if (parsed.signature.length !== 64) return { ok: false, reason: "bad-signature" };

  const subtle: SubtleCrypto | undefined = (globalThis as any).crypto?.subtle;
  if (!subtle) return { ok: false, reason: "no-crypto" };
  let valid = false;
  try {
    const key = await subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    valid = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      parsed.signature as BufferSource,
      new TextEncoder().encode(parsed.signingInput)
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad-signature" };

  const failure = checkGrantClaims(parsed.claims, expected, opts.now);
  if (failure) return { ok: false, reason: failure };
  return { ok: true, claims: parsed.claims };
}
