
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type StoreSelectorState = {
  selectedStoreId: string | null;
  setSelectedStoreId: (storeId: string | null) => void;
};

export const useStoreSelector = create(
  persist<StoreSelectorState>(
    (set) => ({
      selectedStoreId: null,
      setSelectedStoreId: (storeId) => set({ selectedStoreId: storeId }),
    }),
    {
      name: 'se_active_store_id', // Local storage key
      storage: createJSONStorage(() => localStorage),
    }
  )
);
