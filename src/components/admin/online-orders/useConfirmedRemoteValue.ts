"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * F13: a store-scoped setting that is shown optimistically while a server
 * request is in flight, but always falls back to the LAST CONFIRMED value.
 *
 *  - `confirm(storeId, value)` records a value the server/Firestore confirmed
 *    (call it from the live snapshot listener).
 *  - `run(next, send)` shows `next` immediately, awaits `send()`, and then:
 *      success → `next` becomes the confirmed value;
 *      failure → the draft is dropped, so the display returns to the last
 *                confirmed value (no reliance on a snapshot that, after a
 *                rejected request, never comes);
 *      store switched while in flight → nothing is applied ("stale").
 *  - Everything is keyed by store, so one store's draft or value never shows
 *    under another.
 */
export type RunResult = "ok" | "failed" | "stale";

export function useConfirmedRemoteValue<T>(storeId: string, fallback: T) {
  const [confirmed, setConfirmed] = useState<{ storeId: string; value: T } | null>(null);
  const [draft, setDraft] = useState<{ storeId: string; value: T; reqId: number } | null>(null);
  const storeIdRef = useRef(storeId);
  storeIdRef.current = storeId;
  const reqSeq = useRef(0);

  // A draft never survives a store switch.
  useEffect(() => {
    setDraft((d) => (d && d.storeId !== storeId ? null : d));
  }, [storeId]);

  const confirm = useCallback((forStoreId: string, value: T) => {
    if (forStoreId !== storeIdRef.current) return;
    setConfirmed({ storeId: forStoreId, value });
  }, []);

  const confirmedValue = confirmed && confirmed.storeId === storeId ? confirmed.value : fallback;
  const value = draft && draft.storeId === storeId ? draft.value : confirmedValue;
  const saving = !!draft && draft.storeId === storeId;

  const run = useCallback(
    async (next: T, send: () => Promise<void>): Promise<{ result: RunResult; error?: unknown }> => {
      const requestStoreId = storeIdRef.current;
      const reqId = ++reqSeq.current;
      setDraft({ storeId: requestStoreId, value: next, reqId });
      try {
        await send();
        if (storeIdRef.current !== requestStoreId) return { result: "stale" };
        setConfirmed({ storeId: requestStoreId, value: next });
        return { result: "ok" };
      } catch (error) {
        if (storeIdRef.current !== requestStoreId) return { result: "stale", error };
        return { result: "failed", error };
      } finally {
        // Only clear our own draft — never a newer request's.
        setDraft((d) => (d && d.reqId === reqId ? null : d));
      }
    },
    []
  );

  return { value, confirmedValue, saving, confirm, run };
}
