
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
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreContextProvider({ children }: { children: React.ReactNode }) {
  const { appUser } = useAuthContext();
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStore, setActiveStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);

  // New state for store-specific addons
  const [storeAddons, setStoreAddons] = useState<any[]>([]);
  const [storeAddonsLoading, setStoreAddonsLoading] = useState(true);

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
      const preferred = storedId ? validStores.find(s => s.id === storedId) : null;
      
      const userHasAccessToStored = preferred && (isPlatformAdmin || assigned.includes(preferred.id));
      
      setActiveStore(userHasAccessToStored ? preferred : validStores[0] || null);

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
      const unsub = fetchStoreAddons();
      return () => { unsub(); }
  }, [fetchStoreAddons])

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
    }),
    [stores, activeStore, loading, setActiveStoreById, loadStoresOnce, storeAddons, storeAddonsLoading, fetchStoreAddons]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStoreContext() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStoreContext must be used within a StoreContextProvider");
  return ctx;
}
