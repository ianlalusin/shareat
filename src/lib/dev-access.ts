import { DEV_ACCESS_CODE, DEV_EMAIL_WHITELIST, DEV_LOCALSTORAGE_KEY } from '@/config/dev';
import type { Staff } from '@/lib/types';
import { User } from 'firebase/auth';

// WARNING: This is a development backdoor used only by the owner
// to recover access if staff/roles are misconfigured.
// Do NOT rely on this as production security.

export function hasDevAccessFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(DEV_LOCALSTORAGE_KEY) === 'true';
  } catch (e) {
    return false;
  }
}

export function buildDevStaffContext(user: User | null): Partial<Staff> | null {
  if (!user) return null;
  
  const email = user.email?.toLowerCase() ?? '';
  if (!DEV_EMAIL_WHITELIST.map(e => e.toLowerCase()).includes(email)) {
    return null;
  }
  
  return {
    id: 'dev-staff',
    authUid: user.uid,
    fullName: 'Dev User',
    email: user.email!,
    position: 'admin',
    assignedStore: 'SharEat Lipa',
    employmentStatus: 'Active',
  };
}
