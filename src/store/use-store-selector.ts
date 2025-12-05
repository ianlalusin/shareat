import { create } from 'zustand';

type StoreSelectorState = {
  selectedStoreId: string | null;
  setSelectedStoreId: (storeId: string | null) => void;
};

export const useStoreSelector = create<StoreSelectorState>((set) => ({
  selectedStoreId: null,
  setSelectedStoreId: (storeId) => set({ selectedStoreId: storeId }),
}));
