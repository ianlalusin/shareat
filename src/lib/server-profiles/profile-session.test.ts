import { describe, expect, it, vi } from "vitest";
import {
  issueProfileSession,
  profileSessionKey,
  verifyProfileSession,
} from "@/lib/server/server-profile-session";
import { classifyRemoteError, resolveStoredProfile, type RemoteCheck } from "./profile-session";

// Audit F02: a stored local-user identity must be a server-signed session
// bound to Firebase uid + store + profile, with an expiry.

const key = profileSessionKey({ CRON_SECRET: "test-cron-secret" })!;
const NOW = 1_800_000_000_000;
const subject = { uid: "uid-A", storeId: "store-1", profileId: "prof-1" };

function stored(token: string, profileId = "prof-1", name = "Ana") {
  return JSON.stringify({ profileId, name, token, expiresAt: NOW + 1000 });
}

/** Server-side truth used as the remote check in client tests. */
function serverCheck(uid: string, storeId: string) {
  return async (s: { token: string; profileId: string }): Promise<RemoteCheck> => {
    const r = verifyProfileSession(s.token, { uid, storeId, profileId: s.profileId }, { now: NOW, key });
    return r.ok ? { kind: "valid", name: "Ana" } : { kind: "invalid", reason: r.reason };
  };
}

describe("server profile session token (server)", () => {
  it("falls back to a key derived from CRON_SECRET, never the raw secret", () => {
    expect(key).not.toBeNull();
    expect(key.toString("utf8")).not.toContain("test-cron-secret");
    expect(profileSessionKey({})).toBeNull();
    expect(profileSessionKey({ SERVER_PROFILE_SESSION_SECRET: "x", CRON_SECRET: "y" })!.equals(
      profileSessionKey({ SERVER_PROFILE_SESSION_SECRET: "x" })!
    )).toBe(true);
  });

  it("accepts a valid token for the same uid/store/profile", () => {
    const s = issueProfileSession(subject, { now: NOW, key })!;
    const r = verifyProfileSession(s.token, subject, { now: NOW + 1000, key });
    expect(r.ok).toBe(true);
  });

  it("rejects a token issued to another uid", () => {
    const s = issueProfileSession({ ...subject, uid: "uid-B" }, { now: NOW, key })!;
    expect(verifyProfileSession(s.token, subject, { now: NOW, key })).toEqual({ ok: false, reason: "wrong-account" });
  });

  it("rejects another store and another profile", () => {
    const s = issueProfileSession(subject, { now: NOW, key })!;
    expect(verifyProfileSession(s.token, { ...subject, storeId: "store-2" }, { now: NOW, key })).toMatchObject({ reason: "wrong-store" });
    expect(verifyProfileSession(s.token, { ...subject, profileId: "prof-2" }, { now: NOW, key })).toMatchObject({ reason: "wrong-profile" });
  });

  it("rejects an expired token", () => {
    const s = issueProfileSession(subject, { now: NOW, key, ttlMs: 1000 })!;
    expect(verifyProfileSession(s.token, subject, { now: NOW + 1000, key })).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a forged token (edited claims or wrong key)", () => {
    const s = issueProfileSession(subject, { now: NOW, key })!;
    const [, mac] = s.token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ v: 1, uid: "uid-A", sid: "store-1", pid: "prof-2", iat: NOW, exp: NOW + 9e9 })).toString("base64url");
    expect(verifyProfileSession(`${forgedBody}.${mac}`, { ...subject, profileId: "prof-2" }, { now: NOW, key })).toMatchObject({ reason: "bad-signature" });
    const other = issueProfileSession(subject, { now: NOW, key: profileSessionKey({ CRON_SECRET: "other" }) })!;
    expect(verifyProfileSession(other.token, subject, { now: NOW, key })).toMatchObject({ reason: "bad-signature" });
    expect(verifyProfileSession("garbage", subject, { now: NOW, key })).toMatchObject({ reason: "malformed" });
  });

  it("issues nothing without a key", () => {
    expect(issueProfileSession(subject, { now: NOW, key: null })).toBeNull();
  });
});

describe("resolveStoredProfile (client rehydrate)", () => {
  const base = { uid: "uid-A", storeId: "store-1", now: NOW, online: true };

  it("rejects a forged localStorage profile with no token (the audit probe)", async () => {
    const verifyRemote = vi.fn();
    const r = await resolveStoredProfile({
      ...base,
      raw: JSON.stringify({ profileId: "someone-else", name: "Another operator" }),
      verifyRemote,
    });
    expect(r.profile).toBeNull();
    expect(r).toMatchObject({ clear: true });
    expect(verifyRemote).not.toHaveBeenCalled();
  });

  it("rejects a forged token whose claims look right, via the server check", async () => {
    const body = Buffer.from(JSON.stringify({ v: 1, uid: "uid-A", sid: "store-1", pid: "prof-1", iat: NOW, exp: NOW + 9e9 })).toString("base64url");
    const r = await resolveStoredProfile({ ...base, raw: stored(`${body}.forged`), verifyRemote: serverCheck("uid-A", "store-1") });
    expect(r).toMatchObject({ profile: null, clear: true, reason: "bad-signature" });
  });

  it("rejects another Firebase account's session without calling the server", async () => {
    const s = issueProfileSession({ ...subject, uid: "uid-B" }, { now: NOW, key })!;
    const verifyRemote = vi.fn();
    const r = await resolveStoredProfile({ ...base, raw: stored(s.token), verifyRemote });
    expect(r).toMatchObject({ profile: null, clear: true, reason: "wrong-account" });
    expect(verifyRemote).not.toHaveBeenCalled();
  });

  it("rejects an expired session, even offline", async () => {
    const s = issueProfileSession(subject, { now: NOW - 10_000, key, ttlMs: 5000 })!;
    const r = await resolveStoredProfile({ ...base, online: false, raw: stored(s.token), verifyRemote: vi.fn() });
    expect(r).toMatchObject({ profile: null, clear: true, reason: "expired" });
  });

  it("rejects a token copied onto a different profile id", async () => {
    const s = issueProfileSession(subject, { now: NOW, key })!;
    const r = await resolveStoredProfile({ ...base, raw: stored(s.token, "prof-boss"), verifyRemote: vi.fn() });
    expect(r).toMatchObject({ profile: null, reason: "wrong-profile" });
  });

  it("accepts a valid session (server-verified)", async () => {
    const s = issueProfileSession(subject, { now: NOW, key })!;
    const r = await resolveStoredProfile({ ...base, raw: stored(s.token), verifyRemote: serverCheck("uid-A", "store-1") });
    expect(r.profile).toMatchObject({ profileId: "prof-1", name: "Ana" });
    expect(r).toMatchObject({ source: "server" });
  });

  // Changed deliberately (audit NOV-PROFILE, 2026-11-03): a legacy HMAC token
  // cannot be verified on the device, so offline/unreachable it is NOT
  // restored any more; the entry is kept for a retry once online. Offline
  // restore of a locally verified ES256 grant is covered in profile-grant.test.ts.
  it("does not restore a legacy HMAC session offline or when the server is unreachable", async () => {
    const s = issueProfileSession(subject, { now: NOW, key })!;
    const off = await resolveStoredProfile({ ...base, online: false, raw: stored(s.token), verifyRemote: vi.fn() });
    expect(off).toEqual({ profile: null, clear: false, reason: "needs-online-check" });
    const down = await resolveStoredProfile({ ...base, raw: stored(s.token), verifyRemote: async () => ({ kind: "unreachable" }) });
    expect(down).toEqual({ profile: null, clear: false, reason: "needs-online-check" });
  });

  it("does not clear storage while signed out (no uid)", async () => {
    const s = issueProfileSession(subject, { now: NOW, key })!;
    const r = await resolveStoredProfile({ ...base, uid: null, raw: stored(s.token), verifyRemote: vi.fn() });
    expect(r).toMatchObject({ profile: null, clear: false });
  });

  it("classifies server errors: 401/403/404 invalid, others unreachable", () => {
    expect(classifyRemoteError({ status: 401 }).kind).toBe("invalid");
    expect(classifyRemoteError({ status: 404 }).kind).toBe("invalid");
    expect(classifyRemoteError({ status: 503 }).kind).toBe("unreachable");
    expect(classifyRemoteError(new TypeError("fetch failed")).kind).toBe("unreachable");
  });
});
