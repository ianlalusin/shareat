"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

/**
 * F12: the online-orders inbox feed.
 *
 * Two independent listeners:
 *  - OPEN set: every order in a non-terminal status, no limit. This is the
 *    operational queue (New / Awaiting payment / Active) and its badge counts —
 *    an old pending order can never fall out of it because newer orders exist.
 *    Single-field `in` filter with no orderBy, so it rides Firestore's automatic
 *    single-field index (same query shape as the main-nav badge) — no composite
 *    index needed. Sorted client-side.
 *  - HISTORY window: newest `historyLimit` orders by createdAtClientMs (the
 *    same shape as the old query, existing automatic index). Only its terminal
 *    rows feed the Completed / Cancelled tabs, which are explicitly windowed
 *    (`historyHasMore` + `loadMoreHistory`).
 *
 * Both are tagged with their store, so a store switch never shows the previous
 * store's orders.
 */

export const OPEN_ORDER_STATUSES = [
  "pending_payment",
  "pending",
  "accepted",
  "preparing",
  "ready",
  "ready_for_pickup",
  "out_for_delivery",
] as const;

export const TERMINAL_ORDER_STATUSES = ["completed", "cancelled", "rejected", "expired"] as const;

export const HISTORY_PAGE_SIZE = 200;

export type FeedOrder = { id: string; status: string; createdAtClientMs?: number; [k: string]: any };

type Tagged<T> = { storeId: string; value: T; loaded: boolean; error: Error | null };

const OPEN_SET = new Set<string>(OPEN_ORDER_STATUSES);
const EMPTY: FeedOrder[] = [];

function byNewest(a: FeedOrder, b: FeedOrder) {
  return (b.createdAtClientMs ?? 0) - (a.createdAtClientMs ?? 0);
}

/**
 * @internal Exported for tests. Merges the two listeners: open-status rows come
 * ONLY from the open set (authoritative, complete), terminal rows ONLY from the
 * history window. A row in both (mid-transition) resolves by which list owns
 * its status.
 */
export function mergeOrderFeeds<T extends FeedOrder>(openOrders: T[], historyOrders: T[]): T[] {
  const out = new Map<string, T>();
  for (const o of openOrders) if (OPEN_SET.has(o.status)) out.set(o.id, o);
  for (const o of historyOrders) {
    if (OPEN_SET.has(o.status)) continue; // the open set is the source of truth for these
    if (!out.has(o.id)) out.set(o.id, o);
  }
  return Array.from(out.values()).sort(byNewest);
}

export function useOnlineOrdersFeed(storeId: string, onError?: (err: Error, which: "open" | "history") => void) {
  const [open, setOpen] = useState<Tagged<FeedOrder[]> | null>(null);
  const [history, setHistory] = useState<Tagged<FeedOrder[]> | null>(null);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);

  // Reset the history window when the store changes.
  useEffect(() => {
    setHistoryLimit(HISTORY_PAGE_SIZE);
  }, [storeId]);

  useEffect(() => {
    if (!storeId) { setOpen(null); return; }
    let cancelled = false;
    setOpen({ storeId, value: [], loaded: false, error: null });
    const q = query(
      collection(db, `stores/${storeId}/onlineOrders`),
      where("status", "in", [...OPEN_ORDER_STATUSES])
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        setOpen({ storeId, value: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })), loaded: true, error: null });
      },
      (err) => {
        if (cancelled) return;
        console.error(err);
        setOpen({ storeId, value: [], loaded: true, error: err });
        onError?.(err, "open");
      }
    );
    return () => { cancelled = true; unsub(); };
    // onError is a notification callback; re-subscribing on its identity would churn reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => {
    if (!storeId) { setHistory(null); return; }
    let cancelled = false;
    // Keep the current rows while a larger window loads ("Load more").
    setHistory((prev) => ({
      storeId,
      value: prev?.storeId === storeId ? prev.value : [],
      loaded: prev?.storeId === storeId ? prev.loaded : false,
      error: null,
    }));
    const q = query(
      collection(db, `stores/${storeId}/onlineOrders`),
      orderBy("createdAtClientMs", "desc"),
      limit(historyLimit)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        setHistory({ storeId, value: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })), loaded: true, error: null });
      },
      (err) => {
        if (cancelled) return;
        console.error(err);
        setHistory((prev) => ({ storeId, value: prev?.storeId === storeId ? prev.value : [], loaded: true, error: err }));
        onError?.(err, "history");
      }
    );
    return () => { cancelled = true; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, historyLimit]);

  const openOrders = open && open.storeId === storeId ? open.value : EMPTY;
  const historyOrders = history && history.storeId === storeId ? history.value : EMPTY;
  const openLoaded = !!open && open.storeId === storeId && open.loaded;
  const historyLoaded = !!history && history.storeId === storeId && history.loaded;

  const orders = useMemo(() => mergeOrderFeeds(openOrders, historyOrders), [openOrders, historyOrders]);

  const loadMoreHistory = useCallback(() => setHistoryLimit((n) => n + HISTORY_PAGE_SIZE), []);

  return {
    orders,
    /** True until the OPEN set has loaded (history may still be loading). */
    isLoading: !!storeId && !openLoaded,
    openError: open && open.storeId === storeId ? open.error : null,
    historyError: history && history.storeId === storeId ? history.error : null,
    historyLoaded,
    /** The history window is full, so older completed/cancelled orders exist. */
    historyHasMore: historyLoaded && historyOrders.length >= historyLimit,
    historyLimit,
    loadMoreHistory,
  };
}

/**
 * Live single-order subscription for the open detail dialog, so an order that
 * leaves both list windows still updates while it is being looked at.
 * Only subscribes when `enabled` (i.e. the order is not in the merged feed).
 */
export function useOrderById<T extends FeedOrder>(storeId: string, orderId: string | null, enabled: boolean) {
  const [state, setState] = useState<{ key: string; order: T | null } | null>(null);
  useEffect(() => {
    if (!storeId || !orderId || !enabled) return;
    const key = `${storeId}/${orderId}`;
    let cancelled = false;
    const unsub = onSnapshot(
      doc(db, `stores/${storeId}/onlineOrders/${orderId}`),
      (snap) => {
        if (cancelled) return;
        setState({ key, order: snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as T) : null });
      },
      () => {} // non-fatal: the dialog keeps the last value it had
    );
    return () => { cancelled = true; unsub(); };
  }, [storeId, orderId, enabled]);
  return state && orderId && state.key === `${storeId}/${orderId}` ? state.order : null;
}
