
"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { doc, getDoc, getDocs, collection, updateDoc, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import type { Store } from "@/lib/types";

type StoreContextValue = {
  stores: Store[];
  activeStore: Store | null;
  loading: boolean;
  setActiveStoreById: (storeId: string) => Promise<void>;
  refreshStoresOnce: () => Promise<void>;
  storeAddons: any[]; // Add this
  storeAddonsLoading: boolean; // Add this
  refreshStoreAddons: () => void; // Add this
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

  const isAdmin = useMemo(() => appUser?.role === 'admin' || (Array.isArray(appUser?.roles) && appUser.roles.includes("admin")), [appUser]);

  const loadStoresOnce = useCallback(async () => {
    if (!appUser) {
      setStores([]);
      setActiveStore(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Admin: one-time load all stores (filter inactive)
      if (isAdmin) {
        const snap = await getDocs(collection(db, "stores"));
        const all = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Store))
          .filter((s: any) => s.isActive !== false);

        setStores(all);

        const preferred = appUser.storeId ? all.find((s) => s.id === appUser.storeId) : null;
        setActiveStore(preferred || all[0] || null);
        return;
      }

      // Non-admin: one-time load only assigned stores
      const assigned = Array.isArray(appUser.assignedStoreIds) ? appUser.assignedStoreIds : [];
      if (assigned.length === 0) {
        setStores([]);
        setActiveStore(null);
        return;
      }

      const fetched: Store[] = [];
      for (const storeId of assigned) {
        const sref = doc(db, "stores", storeId);
        const ssnap = await getDoc(sref);
        if (!ssnap.exists()) continue;

        const s = { id: ssnap.id, ...ssnap.data() } as Store;
        if ((s as any).isActive !== false) fetched.push(s);
      }

      setStores(fetched);

      const preferred = appUser.storeId ? fetched.find((s) => s.id === appUser.storeId) : null;
      setActiveStore(preferred || fetched[0] || null);
    } finally {
      setLoading(false);
    }
  }, [appUser, isAdmin]);

  const fetchStoreAddons = useCallback(async () => {
    if (!activeStore?.id) {
        setStoreAddons([]);
        setStoreAddonsLoading(false);
        return;
    }
    setStoreAddonsLoading(true);

    // This query is simplified for demonstration. You might need a more complex
    // query joining with a global `products` collection if `storeAddons` only stores overrides.
    const addonsRef = collection(db, "stores", activeStore.id, "inventory");
    const q = query(addonsRef, where("isAddon", "==", true), where("isActive", "==", true));
    
    // Using onSnapshot for realtime updates, but getDocs would also work for a one-time fetch.
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const addonsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
      return () => {
        if (unsub) {
            // If fetchStoreAddons returns an unsubscribe function
            unsub.then(u => u()).catch(() => {});
        }
      }
  }, [fetchStoreAddons])

  const setActiveStoreById = useCallback(
    async (storeId: string) => {
      if (!appUser) return;

      if (!isAdmin) {
        const allowed = new Set(Array.isArray(appUser.assignedStoreIds) ? appUser.assignedStoreIds : []);
        if (!allowed.has(storeId)) {
          throw new Error("Store not assigned to this user.");
        }
      }

      await updateDoc(doc(db, "users", appUser.uid), { storeId });

      const next = stores.find((s) => s.id === storeId) || null;
      setActiveStore(next);
    },
    [appUser, isAdmin, stores]
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      stores,
      activeStore,
      loading,
      setActiveStoreById,
      refreshStoresOnce: loadStoresOnce,
      storeAddons,
      storeAddonsLoading,
      refreshStoreAddons: () => { fetchStoreAddons() },
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
