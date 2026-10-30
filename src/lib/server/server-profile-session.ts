import { createHmac, timingSafeEqual } from "node:crypto";

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
 */

export const PROFILE_SESSION_TTL_MS = 16 * 60 * 60 * 1000; // one long shift
const KEY_LABEL = "shareat:server-profile-session:v1";

export type ProfileSessionPayload = {
  v: 1;
  uid: string;
  sid: string; // storeId
  pid: string; // profileId
  iat: number; // ms
  exp: number; // ms
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

export function issueProfileSession(
  subject: { uid: string; storeId: string; profileId: string },
  opts: { now?: number; ttlMs?: number; key?: Buffer | null } = {}
): { token: string; expiresAt: number } | null {
  const key = opts.key === undefined ? profileSessionKey() : opts.key;
  if (!key) return null;
  const now = opts.now ?? Date.now();
  const payload: ProfileSessionPayload = {
    v: 1,
    uid: subject.uid,
    sid: subject.storeId,
    pid: subject.profileId,
    iat: now,
    exp: now + (opts.ttlMs ?? PROFILE_SESSION_TTL_MS),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${body}.${sign(key, body)}`, expiresAt: payload.exp };
}

export function verifyProfileSession(
  token: unknown,
  expected: { uid: string; storeId: string; profileId?: string },
  opts: { now?: number; key?: Buffer | null } = {}
): ProfileSessionCheck {
  const key = opts.key === undefined ? profileSessionKey() : opts.key;
  if (!key) return { ok: false, reason: "no-key" };
  if (typeof token !== "string" || token.length > 2048) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
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
