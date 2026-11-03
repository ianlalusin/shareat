"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postServerProfileOp } from "@/lib/server-profiles/api";
import {
  classifyRemoteError,
  resolveStoredProfile,
  storesToClearOnContextChange,
  type RemoteCheck,
  type StoredProfileSession,
} from "@/lib/server-profiles/profile-session";

export interface ServerProfileState {
  profileId: string;
  name: string;
}

/** What /api/server-profiles returns next to a verified profile. */
export interface ProfileSessionGrant {
  token: string;
  expiresAt: number;
}

const keyFor = (storeId: string) => `shareat:serverProfile:${storeId}`;
const REMOTE_CHECK_TIMEOUT_MS = 5000;

async function verifyRemote(storeId: string, s: StoredProfileSession): Promise<RemoteCheck> {
  const timeout = new Promise<RemoteCheck>((resolve) =>
    setTimeout(() => resolve({ kind: "unreachable" }), REMOTE_CHECK_TIMEOUT_MS)
  );
  const call = postServerProfileOp({ op: "check-session", storeId, profileId: s.profileId, token: s.token })
    .then((json): RemoteCheck => ({ kind: "valid", name: json?.profile?.name }))
    .catch(classifyRemoteError);
  return Promise.race([call, timeout]);
}

function removeStored(storeId: string) {
  try {
    window.localStorage.removeItem(keyFor(storeId));
  } catch {}
}

/**
 * Device-local operator ("local user") for the active store.
 *
 * Audit F02: the stored identity is only trusted with a server-signed session
 * token bound to this Firebase uid + store + profile, with an expiry. On
 * rehydrate an ES256 grant is verified on the device (pinned public key) and
 * then by the server (profile still exists, passcode not reset). A bare or
 * edited localStorage entry, a fabricated signature, another account's
 * session, or an expired one is cleared and the passcode gate shows. If the
 * server is unreachable (offline shift) only a locally VERIFIED grant is kept,
 * so it stays one passcode per shift; a legacy HMAC token waits for the server.
 * When the device comes back online the server check runs again, and a
 * profile revoked meanwhile (passcode reset, deleted) is dropped.
 *
 * Account or store change clears the stored entry it belonged to
 * (storesToClearOnContextChange) and the in-memory profile at once.
 *
 * `uid`: undefined while Firebase auth is still resolving (hook stays
 * not-ready), null when signed out.
 */
export function useServerProfile(storeId: string | null | undefined, uid?: string | null) {
  const [currentProfile, setCurrentProfile] = useState<ServerProfileState | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  // isReady is DERIVED from which (store, uid) pair storage was last resolved
  // for, so the render between a store/account change and the effect finishing
  // reports not-ready (no flash of the sign-in gate for signed-in users).
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const currentKey = uid === undefined ? null : `${storeId ?? ""}|${uid ?? ""}`;
  // Last resolved (store, account) pair, to detect a context change.
  const prevContextRef = useRef<{ storeId: string | null; uid: string | null } | null>(null);
  // Bumped on the browser "online" event to re-run the server check.
  const [recheckTick, setRecheckTick] = useState(0);

  useEffect(() => {
    const onOnline = () => setRecheckTick((n) => n + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    if (uid === undefined) return; // auth still resolving
    const key = `${storeId ?? ""}|${uid ?? ""}`;
    const next = { storeId: storeId ?? null, uid };
    const prev = prevContextRef.current;
    // Same context again = the reconnect re-check, not a fresh load.
    const isRecheck = !!prev && prev.storeId === next.storeId && prev.uid === next.uid;
    if (!isRecheck) {
      for (const s of storesToClearOnContextChange(prev, next)) removeStored(s);
      // Never show the previous account's/store's operator while resolving.
      if (prev) {
        setCurrentProfile(null);
        setExpiresAt(null);
      }
      prevContextRef.current = next;
    }
    if (!storeId) {
      setCurrentProfile(null);
      setExpiresAt(null);
      setLoadedKey(key);
      return;
    }
    let cancelled = false;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(keyFor(storeId));
    } catch {}

    void resolveStoredProfile({
      raw,
      uid,
      storeId,
      now: Date.now(),
      online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
      verifyRemote: (s) => verifyRemote(storeId, s),
    }).then((res) => {
      if (cancelled) return;
      let rawNow: string | null = null;
      try {
        rawNow = window.localStorage.getItem(keyFor(storeId));
      } catch {}
      // signIn/signOut ran while the check was in flight: their state wins.
      if (rawNow !== raw) {
        setLoadedKey(key);
        return;
      }
      if (res.profile) {
        setCurrentProfile({ profileId: res.profile.profileId, name: res.profile.name });
        setExpiresAt(res.profile.expiresAt);
      } else if (isRecheck && !res.clear) {
        // Still offline/unreachable, or a tab-only operator with nothing
        // stored: keep the current state, the next reconnect tries again.
      } else {
        if (res.clear) removeStored(storeId);
        setCurrentProfile(null);
        setExpiresAt(null);
      }
      setLoadedKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, [storeId, uid, recheckTick]);

  // Session expiry during a running shift: drop the profile, show the gate.
  useEffect(() => {
    if (!storeId || !expiresAt) return;
    const ms = Math.min(expiresAt - Date.now(), 2 ** 31 - 1);
    const clear = () => {
      removeStored(storeId);
      setCurrentProfile(null);
      setExpiresAt(null);
    };
    if (ms <= 0) {
      clear();
      return;
    }
    const t = setTimeout(clear, ms);
    return () => clearTimeout(t);
  }, [storeId, expiresAt]);

  const isReady = currentKey !== null && loadedKey === currentKey;

  const signIn = useCallback(
    (profileId: string, name: string, session?: ProfileSessionGrant | null) => {
      if (!storeId) return;
      if (session && typeof session.token === "string" && typeof session.expiresAt === "number") {
        const next: StoredProfileSession = { profileId, name, token: session.token, expiresAt: session.expiresAt };
        try {
          window.localStorage.setItem(keyFor(storeId), JSON.stringify(next));
        } catch {}
        setExpiresAt(session.expiresAt);
      } else {
        // No signed session (server has no signing secret): keep the operator
        // for this tab only; a reload asks for the passcode again.
        removeStored(storeId);
        setExpiresAt(null);
      }
      setCurrentProfile({ profileId, name });
    },
    [storeId]
  );

  const signOut = useCallback(() => {
    if (!storeId) return;
    removeStored(storeId);
    setCurrentProfile(null);
    setExpiresAt(null);
  }, [storeId]);

  return { currentProfile, signIn, signOut, isReady };
}
