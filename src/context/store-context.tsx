"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { doc, getDoc, getDocs, collection, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/context/auth-context";
import type { Store } from "@/lib/types";

type StoreContextValue = {
  stores: Store[];
  activeStore: Store | null;
  loading: boolean;
  setActiveStoreById: (storeId: string) => Promise<void>;
  refreshStoresOnce: () => Promise<void>;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { appUser } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStore, setActiveStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = useMemo(() => !!appUser?.roles?.includes("admin"), [appUser]);

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

  useEffect(() => {
    loadStoresOnce();
  }, [loadStoresOnce]);

  const setActiveStoreById = useCallback(
    async (storeId: string) => {
      if (!appUser) return;

      // Non-admin: block selecting a store not assigned
      if (!isAdmin) {
        const allowed = new Set(Array.isArray(appUser.assignedStoreIds) ? appUser.assignedStoreIds : []);
        if (!allowed.has(storeId)) {
          throw new Error("Store not assigned to this user.");
        }
      }

      await updateDoc(doc(db, "users", appUser.uid), { storeId });

      // Update local state immediately (no re-subscribe; one-time load model)
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
    }),
    [stores, activeStore, loading, setActiveStoreById, loadStoresOnce]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
