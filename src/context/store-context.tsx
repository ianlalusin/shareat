
"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { doc, getDoc, getDocs, collection, updateDoc, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import type { Store } from "@/lib/types";
import { getDisplayName } from "@/lib/products/variants";

type StoreContextValue = {
  stores: Store[];
  activeStore: Store | null;
  activeStoreId: string | null;
  loading: boolean;
  setActiveStoreById: (storeId: string) => Promise<void>;
  refreshStoresOnce: () => Promise<void>;
  storeAddons: any[];
  storeAddonsLoading: boolean;
  refreshStoreAddons: () => void;
  /**
   * Idempotent. Call from a consumer (e.g. AddonsPOSModal) on mount to opt in
   * to the store's inventory/addons subscription. Devices that never open the
   * addons picker (kitchen, dashboard, settings) avoid the initial 100+ doc
   * read entirely. Once enabled, the subscription persists for the session so
   * repeated modal opens stay instant.
   */
  enableStoreAddons: () => void;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreContextProvider({ children }: { children: React.ReactNode }) {
  const { appUser } = useAuthContext();
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStore, setActiveStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);

  // Store-specific addons — lazy. The subscription stays dormant until a
  // consumer calls `enableStoreAddons()` (typically the cashier addon picker
  // on first mount), then persists for the rest of the session.
  const [storeAddons, setStoreAddons] = useState<any[]>([]);
  const [storeAddonsLoading, setStoreAddonsLoading] = useState(false);
  const [addonsEnabled, setAddonsEnabled] = useState(false);

  const isPlatformAdmin = useMemo(() => appUser?.isPlatformAdmin === true, [appUser]);

  const loadStoresOnce = useCallback(async () => {
    if (!appUser) {
      setStores([]);
      setActiveStore(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let fetchedStores: Store[] = [];
      const assigned = Array.isArray(appUser.assignedStoreIds) ? appUser.assignedStoreIds : [];

      if (isPlatformAdmin) {
        const q = query(collection(db, "stores"));
        const querySnapshot = await getDocs(q);
        fetchedStores = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Store));
      } else if (assigned.length > 0) {
          const storePromises = assigned.map(storeId => getDoc(doc(db, "stores", storeId)));
          const results = await Promise.all(storePromises);
          fetchedStores = results
              .filter(snap => snap.exists())
              .map(snap => ({ id: snap.id, ...snap.data() } as Store));
      }
      
      const validStores = fetchedStores
        .filter(s => (s as any).isActive !== false)
        .sort((a, b) => a.name.localeCompare(b.name));
      
      setStores(validStores);

      const storedId = localStorage.getItem('activeStoreId');
      let activeStoreCandidate: Store | null = null;

      // 1. Try from localStorage if it's a valid store the user can access.
      if (storedId) {
          const fromStorage = validStores.find(s => s.id === storedId);
          if (fromStorage) {
              activeStoreCandidate = fromStorage;
          }
      }

      // 2. If not found in storage, try the user's first assigned store.
      if (!activeStoreCandidate && assigned.length > 0) {
          const firstAssignedId = assigned[0];
          activeStoreCandidate = validStores.find(s => s.id === firstAssignedId) || null;
      }

      // 3. If still no candidate, fall back to the first store in the sorted list.
      if (!activeStoreCandidate && validStores.length > 0) {
          activeStoreCandidate = validStores[0];
      }

      setActiveStore(activeStoreCandidate);

    } catch (e) {
      console.error("Failed to load stores:", e);
      setStores([]);
      setActiveStore(null);
    } finally {
      setLoading(false);
    }
  }, [appUser, isPlatformAdmin]);

  useEffect(() => {
    if (!appUser) {
        // Clear stores and active store immediately on logout
        setStores([]);
        setActiveStore(null);
        setLoading(false);
    } else {
        loadStoresOnce();
    }
  }, [appUser, loadStoresOnce]);


  const fetchStoreAddons = useCallback(() => {
    if (!activeStore?.id || !appUser) {
        setStoreAddons([]);
        setStoreAddonsLoading(false);
        return () => {};
    }
    setStoreAddonsLoading(true);

    const addonsRef = collection(db, "stores", activeStore.id, "inventory");
    const q = query(addonsRef, where("isAddon", "==", true), where("isActive", "==", true));

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const addonsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            displayName: getDisplayName(doc.data() as any),
            groupKey: (doc.data() as any).groupId || doc.id,
        }));
        setStoreAddons(addonsData);
        setStoreAddonsLoading(false);
    }, (error) => {
        if(appUser) {
          console.error("Failed to fetch store addons:", error);
        }
        setStoreAddonsLoading(false);
    });

    return unsubscribe;
  }, [activeStore?.id, appUser]);


  useEffect(() => {
      if (!addonsEnabled) return;
      const unsub = fetchStoreAddons();
      return () => { unsub(); }
  }, [addonsEnabled, fetchStoreAddons])

  const enableStoreAddons = useCallback(() => {
      setAddonsEnabled((prev) => prev || true);
  }, []);

  const setActiveStoreById = useCallback(
    async (storeId: string) => {
      localStorage.setItem('activeStoreId', storeId);
      const next = stores.find((s) => s.id === storeId) || null;
      setActiveStore(next);
    },
    [stores]
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      stores,
      activeStore,
      activeStoreId: activeStore?.id || null,
      loading,
      setActiveStoreById,
      refreshStoresOnce: loadStoresOnce,
      storeAddons,
      storeAddonsLoading,
      refreshStoreAddons: fetchStoreAddons,
      enableStoreAddons,
    }),
    [stores, activeStore, loading, setActiveStoreById, loadStoresOnce, storeAddons, storeAddonsLoading, fetchStoreAddons, enableStoreAddons]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStoreContext() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStoreContext must be used within a StoreContextProvider");
  return ctx;
}
