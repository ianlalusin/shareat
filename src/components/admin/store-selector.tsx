"use client";

import { useState, useEffect } from "react";
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

type Store = {
  id: string;
  storeName: string;
};

export function StoreSelector() {
  const [stores, setStores] = useState<Store[]>([]);
  const firestore = useFirestore();

  useEffect(() => {
    if (firestore) {
      const unsubscribe = onSnapshot(
        collection(firestore, "stores"),
        (snapshot) => {
          const storesData = snapshot.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() } as Store)
          );
          setStores(storesData);
        }
      );
      return () => unsubscribe();
    }
  }, [firestore]);

  return (
    <Select defaultValue={stores.length > 0 ? stores[0].id : ""}>
      <SelectTrigger className="w-full md:w-[200px] lg:w-[240px] bg-transparent border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10 focus:ring-accent data-[state=open]:bg-primary-foreground/10">
        <div className="flex items-center gap-2">
          <StoreIcon className="h-4 w-4" />
          <SelectValue placeholder="Select a store" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {stores.map((store) => (
          <SelectItem key={store.id} value={store.id}>
            {store.storeName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
