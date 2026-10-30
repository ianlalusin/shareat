
'use client';

import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { StoreTable, StorePackage, StoreFlavor, MenuSchedule, Discount, Charge, ModeOfPayment } from '@/lib/types';

export interface StoreConfig {
  tables: StoreTable[];
  packages: StorePackage[];
  flavors: StoreFlavor[];
  schedules: MenuSchedule[];
  discounts: Discount[];
  charges: Charge[];
  modesOfPayment: ModeOfPayment[];
  meta?: {
    updatedAt?: any;
    version?: number;
  };
}

/**
 * What the listener last delivered, tagged with the store it belongs to.
 * F17: data is only ever returned for the store it was read from — a value
 * tagged with a different store is treated as "nothing loaded yet".
 */
type ConfigState = {
  storeId: string;
  config: StoreConfig | null;
  error: Error | null;
  loaded: boolean;
};

export interface UseStoreConfigDocResult {
  /** The CURRENT store's config, or null (missing doc, still loading, or error). */
  config: StoreConfig | null;
  isLoading: boolean;
  /** Listener failure for the CURRENT store. When set, `config` is null. */
  error: Error | null;
  /** The store `config` belongs to (always the requested store, or null). */
  configStoreId: string | null;
  /** Re-subscribe after an error. */
  retry: () => void;
}

export function useStoreConfigDoc(storeId?: string | null): UseStoreConfigDocResult {
  const [state, setState] = useState<ConfigState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    if (!storeId) {
      setState(null);
      return;
    }

    // Drop anything from a previous store / attempt before the new listener reports.
    setState({ storeId, config: null, error: null, loaded: false });
    let cancelled = false;
    const configRef = doc(db, 'stores', storeId, 'storeConfig', 'current');

    const unsubscribe = onSnapshot(
      configRef,
      (snapshot) => {
        if (cancelled) return;
        let next: StoreConfig | null = null;
        if (snapshot.exists()) {
          const data = snapshot.data() as DocumentData;
          next = {
            tables: data.tables || [],
            packages: data.packages || [],
            flavors: data.flavors || [],
            schedules: data.schedules || [],
            discounts: data.discounts || [],
            charges: data.charges || [],
            modesOfPayment: data.modesOfPayment || [],
            meta: data.meta || {},
          };
        }
        setState({ storeId, config: next, error: null, loaded: true });
      },
      (err) => {
        if (cancelled) return;
        console.error('Error fetching store config:', err);
        // Never keep a config on error: financial screens must not price or
        // take payment from data that cannot be confirmed for this store.
        setState({ storeId, config: null, error: err, loaded: true });
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [storeId, attempt]);

  if (!storeId) {
    return { config: null, isLoading: false, error: null, configStoreId: null, retry };
  }
  // Render-time guard: the effect above runs AFTER the render in which the store
  // changed, so for that one render `state` still holds the old store. Treat a
  // mismatched tag as "loading" so no consumer ever sees store A's config with
  // store B selected.
  if (!state || state.storeId !== storeId) {
    return { config: null, isLoading: true, error: null, configStoreId: null, retry };
  }
  return {
    config: state.error ? null : state.config,
    isLoading: !state.loaded,
    error: state.error,
    configStoreId: state.config && !state.error ? storeId : null,
    retry,
  };
}
