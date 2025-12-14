
import { create } from 'zustand';
import type { Staff } from '@/lib/types';

type StaffDoc = Staff & { id: string };

type OnboardingStoreState = {
  staffToVerify: StaffDoc | null;
  staffListToResolve: StaffDoc[];
  setStaffToVerify: (staff: StaffDoc | null) => void;
  setStaffListToResolve: (staffList: StaffDoc[]) => void;
};

export const useOnboardingStore = create<OnboardingStoreState>((set) => ({
  staffToVerify: null,
  staffListToResolve: [],
  setStaffToVerify: (staff) => set({ staffToVerify: staff }),
  setStaffListToResolve: (staffList) => set({ staffListToResolve: staffList }),
}));
