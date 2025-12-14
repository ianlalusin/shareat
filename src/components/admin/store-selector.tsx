
"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Store as StoreIcon } from "lucide-react";
import { useFirestore } from "@/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import { useStoreSelector } from "@/store/use-store-selector";
import { useAuthContext } from "@/context/auth-context";
import { Store } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

export function StoreSelector() {
  const [allStores, setAllStores] = useState<Store[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);
  const firestore = useFirestore();
  const { selectedStoreId, setSelectedStoreId } = useStoreSelector();
  const { appUser, devMode, setActiveStoreId } = useAuthContext();
  const { toast } = useToast();

  const isMultiStoreUser = devMode || appUser?.role === 'admin' || (appUser?.storeIds && appUser.storeIds.length > 1);

  useEffect(() => {
    if (firestore) {
      const unsubscribe = onSnapshot(
        collection(firestore, "stores"),
        (snapshot) => {
          const storesData = snapshot.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() } as Store)
          );
          setAllStores(storesData);
        }
      );
      return () => unsubscribe();
    }
  }, [firestore]);

  const availableStores = useMemo(() => {
    if (devMode || appUser?.role === 'admin') {
      return allStores;
    }
    if (appUser?.storeIds) {
      const userStoreIds = new Set(appUser.storeIds);
      return allStores.filter(store => userStoreIds.has(store.id));
    }
    return [];
  }, [allStores, appUser, devMode]);
  
  useEffect(() => {
    if (availableStores.length > 0 && !selectedStoreId) {
        const defaultStore = appUser?.activeStoreId && availableStores.find(s => s.id === appUser.activeStoreId);
        if (defaultStore) {
            setSelectedStoreId(defaultStore.id);
        } else if (availableStores.length > 0) {
            setSelectedStoreId(availableStores[0].id);
        }
    } else if (availableStores.length > 0 && selectedStoreId && !availableStores.some(s => s.id === selectedStoreId)) {
        setSelectedStoreId(availableStores[0].id);
    } else if (availableStores.length === 0) {
        setSelectedStoreId(null);
    }
  }, [availableStores, selectedStoreId, setSelectedStoreId, appUser?.activeStoreId]);


  const handleStoreChange = async (newStoreId: string) => {
    if (newStoreId === selectedStoreId) return;
    setIsSwitching(true);
    try {
      await setActiveStoreId(newStoreId);
      setSelectedStoreId(newStoreId); // This syncs Zustand/localStorage
      toast({
        title: "Store Switched",
        description: `You are now managing ${allStores.find(s => s.id === newStoreId)?.storeName}.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Switch Failed",
        description: error instanceof Error ? error.message : "Could not switch stores.",
      });
    } finally {
      setIsSwitching(false);
    }
  }

  return (
    <Select 
      value={selectedStoreId || ''} 
      onValueChange={handleStoreChange}
      disabled={!isMultiStoreUser || isSwitching}
    >
      <SelectTrigger className="w-full md:w-[200px] lg:w-[240px] bg-transparent border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10 focus:ring-accent data-[state=open]:bg-primary-foreground/10">
        <div className="flex items-center gap-2">
          <StoreIcon className="h-4 w-4" />
          <SelectValue placeholder={isSwitching ? "Switching..." : "Select a store"} />
        </div>
      </SelectTrigger>
      <SelectContent>
        {availableStores.map((store) => (
          <SelectItem key={store.id} value={store.id}>
            {store.storeName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
