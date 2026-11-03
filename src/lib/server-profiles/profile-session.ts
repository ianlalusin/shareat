import type { GrantPublicKey } from "./grant-public-key";
import { isGrantToken, verifyGrantLocally } from "./profile-grant";

/**
 * Client-side handling of the signed local-profile session (audit F02).
 *
 * Pure functions only (no React, no Firebase) so they can be unit-tested.
 *
 * Two token kinds can be stored:
 *   - ES256 grant (three parts): verified ON THE DEVICE with the pinned public
 *     key (alg, kid, signature, issuer, lifetime, uid, store, profile, expiry).
 *     Only such a grant may restore a profile offline or when the server check
 *     times out. Online, the server is still asked (op "check-session") so a
 *     deleted profile or a passcode reset logs the operator out.
 *   - Legacy HMAC session (two parts): the device cannot check its signature,
 *     so it restores ONLY after the server confirms it. Offline or timed out,
 *     the profile is not restored (the stored entry is kept for a retry on
 *     reconnect). Its claims are still pre-checked to clear obvious mismatches.
 *
 * Audit NOV-PROFILE (2026-11-03): previously both kinds were restored offline
 * from unverified claims, so `body.fake-signature` impersonated any operator.
 */

export interface StoredProfileSession {
  profileId: string;
  name: string;
  token: string;
  expiresAt: number;
}

export type ClaimsCheck =
  | { ok: true; exp: number }
  | { ok: false; reason: "missing" | "malformed" | "wrong-account" | "wrong-store" | "wrong-profile" | "expired" };

export type RemoteCheck =
  | { kind: "valid"; name?: string }
  | { kind: "invalid"; reason?: string }
  | { kind: "unreachable" };

export type ResolveResult =
  | { profile: StoredProfileSession; source: "server" | "local-offline" }
  | { profile: null; clear: boolean; reason: string };

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Reads a LEGACY two-part token's claims WITHOUT verifying the signature. Used
 * only to drop obvious mismatches early; never enough to restore a profile.
 */
export function readTokenClaims(token: string): { uid: string; sid: string; pid: string; exp: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [body, mac] = parts;
    if (!body || !mac) return null;
    const p = JSON.parse(decodeBase64Url(body));
    if (!p || p.v !== 1 || typeof p.uid !== "string" || typeof p.sid !== "string" || typeof p.pid !== "string" || typeof p.exp !== "number") {
      return null;
    }
    return { uid: p.uid, sid: p.sid, pid: p.pid, exp: p.exp };
  } catch {
    return null;
  }
}

export function parseStoredProfile(raw: string | null): StoredProfileSession | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (
      p &&
      typeof p.profileId === "string" &&
      typeof p.name === "string" &&
      typeof p.token === "string" &&
      typeof p.expiresAt === "number"
    ) {
      return { profileId: p.profileId, name: p.name, token: p.token, expiresAt: p.expiresAt };
    }
  } catch {}
  return null;
}

/** Unverified claims pre-check for a legacy token. */
export function checkClaims(
  stored: StoredProfileSession | null,
  ctx: { uid: string; storeId: string; now: number }
): ClaimsCheck {
  if (!stored) return { ok: false, reason: "missing" };
  const c = readTokenClaims(stored.token);
  if (!c) return { ok: false, reason: "malformed" };
  if (c.uid !== ctx.uid) return { ok: false, reason: "wrong-account" };
  if (c.sid !== ctx.storeId) return { ok: false, reason: "wrong-store" };
  if (c.pid !== stored.profileId) return { ok: false, reason: "wrong-profile" };
  if (c.exp <= ctx.now) return { ok: false, reason: "expired" };
  return { ok: true, exp: c.exp };
}

/** Maps a postServerProfileOp failure onto a remote-check outcome. */
export function classifyRemoteError(err: any): RemoteCheck {
  const status = Number(err?.status);
  if (status === 401 || status === 403 || status === 404) return { kind: "invalid", reason: err?.message };
  return { kind: "unreachable" };
}

export async function resolveStoredProfile(args: {
  raw: string | null;
  uid: string | null;
  storeId: string;
  now: number;
  online: boolean;
  verifyRemote: (s: StoredProfileSession) => Promise<RemoteCheck>;
  /** Test hook; defaults to the keys pinned in grant-public-key.ts. */
  publicKeys?: readonly GrantPublicKey[];
}): Promise<ResolveResult> {
  if (!args.raw) return { profile: null, clear: false, reason: "none" };
  if (!args.uid) return { profile: null, clear: false, reason: "signed-out" };
  const stored = parseStoredProfile(args.raw);
  if (!stored) return { profile: null, clear: true, reason: "malformed" };

  // ES256 grant: verify locally first; a failure is final.
  if (isGrantToken(stored.token)) {
    const local = await verifyGrantLocally(
      stored.token,
      { uid: args.uid, storeId: args.storeId, profileId: stored.profileId },
      { now: args.now, publicKeys: args.publicKeys }
    );
    if (!local.ok) {
      // A device without WebCrypto cannot judge the grant: keep it for the server.
      if (local.reason === "no-crypto") return resolveOnlineOnly(args, stored, stored.expiresAt);
      return { profile: null, clear: true, reason: local.reason };
    }
    // Name and expiry come from the signed claims, not the editable entry.
    const verified: StoredProfileSession = {
      ...stored,
      name: local.claims.nm || stored.name,
      expiresAt: local.claims.exp,
    };
    if (!args.online) return { profile: verified, source: "local-offline" };
    const remote = await args.verifyRemote(stored);
    if (remote.kind === "invalid") return { profile: null, clear: true, reason: remote.reason || "rejected" };
    if (remote.kind === "unreachable") return { profile: verified, source: "local-offline" };
    return { profile: { ...verified, name: remote.name || verified.name }, source: "server" };
  }

  // Legacy HMAC session: claims pre-check, then the server must confirm.
  const claims = checkClaims(stored, { uid: args.uid, storeId: args.storeId, now: args.now });
  if (!claims.ok) return { profile: null, clear: true, reason: claims.reason };
  return resolveOnlineOnly(args, stored, claims.exp);
}

async function resolveOnlineOnly(
  args: { online: boolean; verifyRemote: (s: StoredProfileSession) => Promise<RemoteCheck> },
  stored: StoredProfileSession,
  exp: number
): Promise<ResolveResult> {
  if (!args.online) return { profile: null, clear: false, reason: "needs-online-check" };
  const remote = await args.verifyRemote(stored);
  if (remote.kind === "invalid") return { profile: null, clear: true, reason: remote.reason || "rejected" };
  if (remote.kind === "unreachable") return { profile: null, clear: false, reason: "needs-online-check" };
  return { profile: { ...stored, name: remote.name || stored.name, expiresAt: exp }, source: "server" };
}

/**
 * Which stores' stored profile entries to remove when the (store, Firebase
 * account) context changes. Account change (A -> B, or A -> signed out) drops
 * the entry of the store in use; a store switch drops the previous store's
 * entry, so going back needs the passcode again. `uid === undefined` means
 * auth is still resolving and is never treated as a change.
 */
export function storesToClearOnContextChange(
  prev: { storeId: string | null; uid: string | null } | null,
  next: { storeId: string | null; uid: string | null }
): string[] {
  if (!prev) return [];
  const out = new Set<string>();
  if (prev.uid && prev.uid !== next.uid) {
    if (prev.storeId) out.add(prev.storeId);
    if (next.storeId) out.add(next.storeId);
  }
  if (prev.storeId && prev.storeId !== next.storeId) out.add(prev.storeId);
  return [...out];
}
