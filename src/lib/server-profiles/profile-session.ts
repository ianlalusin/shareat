/**
 * Client-side handling of the signed local-profile session (audit F02).
 *
 * Pure functions only (no React, no Firebase) so they can be unit-tested.
 * The browser cannot check the HMAC signature — only the server holds the key —
 * so rehydration does two things:
 *   1. a local check of the token's (unverified) claims: same Firebase uid,
 *      same store, same profile, not expired. Anything else is cleared.
 *   2. a server check (op "check-session") that verifies the signature, that
 *      the profile still exists and that its passcode was not reset since.
 *      If the server cannot be reached (offline shift), the locally-checked
 *      profile is kept so an offline cashier is not locked out mid-shift.
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

/** Reads the token's claims WITHOUT verifying the signature (server's job). */
export function readTokenClaims(token: string): { uid: string; sid: string; pid: string; exp: number } | null {
  try {
    const [body, mac] = token.split(".");
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
}): Promise<ResolveResult> {
  if (!args.raw) return { profile: null, clear: false, reason: "none" };
  if (!args.uid) return { profile: null, clear: false, reason: "signed-out" };
  const stored = parseStoredProfile(args.raw);
  const claims = checkClaims(stored, { uid: args.uid, storeId: args.storeId, now: args.now });
  if (!claims.ok || !stored) return { profile: null, clear: true, reason: claims.ok ? "missing" : claims.reason };

  if (!args.online) return { profile: { ...stored, expiresAt: claims.exp }, source: "local-offline" };

  const remote = await args.verifyRemote(stored);
  if (remote.kind === "invalid") return { profile: null, clear: true, reason: remote.reason || "rejected" };
  if (remote.kind === "unreachable") return { profile: { ...stored, expiresAt: claims.exp }, source: "local-offline" };
  return {
    profile: { ...stored, name: remote.name || stored.name, expiresAt: claims.exp },
    source: "server",
  };
}
