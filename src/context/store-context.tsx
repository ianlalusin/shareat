
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

  const isAdmin = useMemo(() => appUser?.role === 'admin', [appUser]);

  const loadStoresOnce = useCallback(async () => {
    if (!appUser) {
      setStores([]);
      setActiveStore(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // All users, including admins, fetch stores based on their assignedStoreIds.
      // This complies with the Firestore rule `allow list: if false` on the /stores collection.
      const assigned = Array.isArray(appUser.assignedStoreIds) ? appUser.assignedStoreIds : [];
      if (assigned.length === 0) {
        setStores([]);
        setActiveStore(null);
        return;
      }

      // Fetch all assigned stores in parallel for efficiency.
      const storePromises = assigned.map(async (storeId) => {
        const sref = doc(db, "stores", storeId);
        const ssnap = await getDoc(sref);
        if (ssnap.exists()) {
            const s = { id: ssnap.id, ...ssnap.data() } as Store;
            if ((s as any).isActive !== false) {
                return s;
            }
        }
        return null;
      });

      const results = await Promise.all(storePromises);
      const validStores = results.filter((s): s is Store => s !== null);

      setStores(validStores);

      const preferred = appUser.storeId ? validStores.find((s) => s.id === appUser.storeId) : null;
      setActiveStore(preferred || validStores[0] || null);

    } catch (e) {
        console.error("Failed to load stores:", e);
        setStores([]);
        setActiveStore(null);
    } finally {
      setLoading(false);
    }
  }, [appUser]);

  const fetchStoreAddons = useCallback(() => {
    if (!activeStore?.id) {
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
        console.error("Failed to fetch store addons:", error);
        setStoreAddonsLoading(false);
    });

    return unsubscribe;
  }, [activeStore?.id]);


  useEffect(() => {
    loadStoresOnce();
  }, [loadStoresOnce]);

  useEffect(() => {
      const unsub = fetchStoreAddons();
      return () => { unsub(); }
  }, [fetchStoreAddons])

  const setActiveStoreById = useCallback(
    async (storeId: string) => {
      if (!appUser) return;
      
      // The firestore rule for updating the user doc's storeId already enforces
      // that the user can only switch to a store in their assignedStoreIds.
      // So, no need for a redundant client-side check.
      await updateDoc(doc(db, "users", appUser.uid), { storeId });

      // After successful DB update, update local state
      const next = stores.find((s) => s.id === storeId) || null;
      setActiveStore(next);
    },
    [appUser, stores]
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
