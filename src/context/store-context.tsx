"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where, doc, updateDoc, serverTimestamp, getDocs, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "./auth-context";
import type { Store, InventoryItem } from "@/lib/types";
import { errorEmitter, FirestorePermissionError } from "@/firebase";
import { getDisplayName, getGroupKey } from "@/lib/products/variants";

export type EnrichedStoreAddon = InventoryItem & {
  displayName: string;
  groupKey: string;
  groupName?: string;
  imageUrl?: string | null;
};

type StoreCtx = {
  activeStoreId: string | null;
  activeStore: Store | null;
  allowedStores: Store[];
  setActiveStore: (storeId: string) => Promise<void>;
  loading: boolean;

  // Cached addons for POS / server pages
  storeAddons: EnrichedStoreAddon[];
  storeAddonsLoading: boolean;
  refreshStoreAddons: () => Promise<void>;
};

const StoreContext = createContext<StoreCtx | undefined>(undefined);

export function StoreContextProvider({ children }: { children: React.ReactNode }) {
  const { appUser, loading: authLoading } = useAuthContext();
  const [allActiveStores, setAllActiveStores] = useState<Store[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);

  // Cached store addons (per activeStoreId)
  const [storeAddons, setStoreAddons] = useState<EnrichedStoreAddon[]>([]);
  const [storeAddonsLoading, setStoreAddonsLoading] = useState(false);

  const activeStoreId = appUser?.storeId || null;

  async function loadStoreAddons(storeId: string) {
    const addonsQuery = query(
      collection(db, "stores", storeId, "inventory"),
      where("isActive", "==", true),
      where("isAddon", "==", true),
    );

    const snap = await getDocs(addonsQuery);
    const inventoryAddons = snap.docs.map(d => ({ ...d.data(), id: d.id } as InventoryItem));

    const enriched = await Promise.all(
      inventoryAddons.map(async (item) => {
        let productData: any = {};
        try {
          const productDoc = await getDoc(doc(db, "products", item.productId));
          if (productDoc.exists()) productData = productDoc.data();
        } catch (e) {
          console.error("[StoreContext] Error fetching product details for addon:", item.id, e);
        }

        const combined = {
          ...productData,
          ...item,
          barcode: item.barcode ?? productData.barcode ?? null,
          imageUrl: productData.imageUrl ?? null,
        };

        const sp = Number((combined as any).sellingPrice);
        const safeSellingPrice = Number.isFinite(sp) ? sp : 0;

        return {
          ...(combined as any),
          sellingPrice: safeSellingPrice,
          displayName: getDisplayName(combined as any),
          groupKey: getGroupKey(combined as any),
          groupName: productData?.groupName || (item as any).name,
          imageUrl: productData?.imageUrl ?? null,
        } as EnrichedStoreAddon;
      })
    );

    enriched.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
    setStoreAddons(enriched);
  }

  const refreshStoreAddons = async () => {
    if (!activeStoreId) {
      setStoreAddons([]);
      return;
    }
    setStoreAddonsLoading(true);
    try {
      await loadStoreAddons(activeStoreId);
    } catch (e) {
      console.error("[StoreContext] Failed to load store addons:", e);
    } finally {
      setStoreAddonsLoading(false);
    }
  };

  // Load addons once per active store change (no realtime needed)
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!activeStoreId) {
        setStoreAddons([]);
        setStoreAddonsLoading(false);
        return;
      }
      setStoreAddonsLoading(true);
      try {
        await loadStoreAddons(activeStoreId);
        if (cancelled) return;
      } catch (e) {
        console.error("[StoreContext] Failed to load store addons:", e);
        if (cancelled) return;
        setStoreAddons([]);
      } finally {
        if (!cancelled) setStoreAddonsLoading(false);
      }
    }

    run();
    return () => { cancelled = true; };
  }, [activeStoreId]);

  // 1. Subscribe to all active stores
  useEffect(() => {
    // Guard: Only run this query if the user is loaded and has a role.
    if (authLoading || !appUser?.role) {
      setLoadingStores(false); // Not loading if we're not going to fetch
      return;
    }

    const storesRef = collection(db, "stores");
    const q = query(storesRef, where("isActive", "==", true));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const storesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Store));
      setAllActiveStores(storesData);
      setLoadingStores(false);
    }, () => {
      const contextualError = new FirestorePermissionError({
        operation: 'list',
        path: 'stores',
      });
      errorEmitter.emit('permission-error', contextualError);
      setLoadingStores(false);
    });

    return () => unsubscribe();
  }, [appUser, authLoading]); // Re-run when user/auth state changes

  // 2. Compute allowed stores based on user role
  const allowedStores = useMemo(() => {
    if (!appUser || authLoading || loadingStores) return [];

    if (appUser.role === 'admin') {
      return allActiveStores;
    }

    const assignedIds = appUser.assignedStoreIds || [];
    return allActiveStores.filter(store => assignedIds.includes(store.id));
  }, [allActiveStores, appUser, authLoading, loadingStores]);

  // 3. Resolve active store and handle auto-selection
  useEffect(() => {
    // Wait for all data to be loaded
    if (!appUser || authLoading || loadingStores || allowedStores.length === 0) return;

    const currentActiveId = appUser.storeId;
    const isActiveStoreAllowed = allowedStores.some(store => store.id === currentActiveId);

    // If current active store is not valid or not set, and there are allowed stores,
    // auto-select the first one.
    if ((!currentActiveId || !isActiveStoreAllowed) && appUser.uid) {
      const firstStoreId = allowedStores[0].id;
      const userDocRef = doc(db, "users", appUser.uid);
      updateDoc(userDocRef, {
        storeId: firstStoreId,
        updatedAt: serverTimestamp(),
      }).catch(err => console.error("Failed to auto-set active store:", err));
    }
  }, [appUser, allowedStores, authLoading, loadingStores]);

  const setActiveStore = async (storeId: string) => {
    if (!appUser) throw new Error("User not authenticated.");

    const userDocRef = doc(db, "users", appUser.uid);
    await updateDoc(userDocRef, {
      storeId: storeId,
      updatedAt: serverTimestamp(),
    });
  };

  const activeStore = useMemo(() => {
    if (!appUser?.storeId || allowedStores.length === 0) return null;
    return allowedStores.find(store => store.id === appUser.storeId) || null;
  }, [allowedStores, appUser?.storeId]);

  const value = useMemo(() => ({
    activeStoreId: appUser?.storeId || null,
    activeStore,
    allowedStores,
    setActiveStore,
    loading: authLoading || loadingStores,

    storeAddons,
    storeAddonsLoading,
    refreshStoreAddons,
  }), [
    appUser?.storeId,
    activeStore,
    allowedStores,
    authLoading,
    loadingStores,
    storeAddons,
    storeAddonsLoading
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStoreContext() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStoreContext must be used within a StoreContextProvider");
  return ctx;
}
