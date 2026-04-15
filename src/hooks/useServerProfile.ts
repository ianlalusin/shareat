"use client";

import { useCallback, useEffect, useState } from "react";

export interface ServerProfileState {
  profileId: string;
  name: string;
}

const keyFor = (storeId: string) => `shareat:serverProfile:${storeId}`;

export function useServerProfile(storeId: string | null | undefined) {
  const [currentProfile, setCurrentProfile] = useState<ServerProfileState | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!storeId) {
      setCurrentProfile(null);
      setIsReady(true);
      return;
    }
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(keyFor(storeId)) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.profileId === "string" && typeof parsed.name === "string") {
          setCurrentProfile(parsed);
        } else {
          setCurrentProfile(null);
        }
      } else {
        setCurrentProfile(null);
      }
    } catch {
      setCurrentProfile(null);
    }
    setIsReady(true);
  }, [storeId]);

  const signIn = useCallback((profileId: string, name: string) => {
    if (!storeId) return;
    const next: ServerProfileState = { profileId, name };
    try {
      window.localStorage.setItem(keyFor(storeId), JSON.stringify(next));
    } catch {}
    setCurrentProfile(next);
  }, [storeId]);

  const signOut = useCallback(() => {
    if (!storeId) return;
    try {
      window.localStorage.removeItem(keyFor(storeId));
    } catch {}
    setCurrentProfile(null);
  }, [storeId]);

  return { currentProfile, signIn, signOut, isReady };
}
