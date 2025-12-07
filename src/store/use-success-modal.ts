
import { create } from 'zustand';

type SuccessModalState = {
  isSuccessModalOpen: boolean;
  openSuccessModal: () => void;
  closeSuccessModal: () => void;
};

export const useSuccessModal = create<SuccessModalState>((set) => ({
  isSuccessModalOpen: false,
  openSuccessModal: () => set({ isSuccessModalOpen: true }),
  closeSuccessModal: () => set({ isSuccessModalOpen: false }),
}));
