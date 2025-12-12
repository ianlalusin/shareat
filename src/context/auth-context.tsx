
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, User as FirebaseAuthUser } from 'firebase/auth';
import { useAuth, useFirestore } from '@/firebase';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { AppUser, Staff } from '@/lib/types';
import { buildDevStaffContext } from '@/lib/dev-access';
import { DEV_ACCESS_CODE, DEV_LOCALSTORAGE_KEY } from '@/config/dev';


interface AuthContextType {
  user: FirebaseAuthUser | null;
  appUser: AppUser | null;
  staff: Staff | null;
  loading: boolean;
  isOnboarded: boolean;
  devMode: boolean;
  setDevMode: (isDev: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthContextProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<FirebaseAuthUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [devMode, setDevModeState] = useState(false);
  const auth = useAuth();
  const firestore = useFirestore();

  useEffect(() => {
    let devAccess = false;
    try {
      devAccess = localStorage.getItem(DEV_LOCALSTORAGE_KEY) === DEV_ACCESS_CODE;
      if (devAccess) {
        setDevModeState(true);
      }
    } catch (e) {
      // localStorage not available
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      const devStaffContext = buildDevStaffContext(currentUser);
      if (devStaffContext) {
        setStaff(devStaffContext as Staff); // Treat dev context as full staff for simplicity here
        setAppUser({
          id: currentUser!.uid,
          staffId: 'dev-staff',
          email: currentUser!.email!,
          displayName: 'Dev User',
          role: 'admin',
          storeID: 'dev-store',
          status: 'active',
          createdAt: serverTimestamp() as any,
          lastLoginAt: serverTimestamp() as any,
        });
        setIsOnboarded(true);
        setLoading(false);
        return;
      }

      if (devMode && !devStaffContext) {
        // Is in devMode via sessionStorage but not whitelisted/flagged
        // Continue with normal auth flow but treat as onboarded
         setIsOnboarded(true);
         setAppUser(null);
         setStaff(null);
         setLoading(false);
         return;
      }


      if (currentUser) {
        const userDocRef = doc(firestore, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const appUserData = userDocSnap.data() as AppUser;
          setAppUser(appUserData);
          setIsOnboarded(true);
          
          if(appUserData.staffId) {
            const staffDocRef = doc(firestore, 'staff', appUserData.staffId);
            const staffDocSnap = await getDoc(staffDocRef);
            if (staffDocSnap.exists()) {
              setStaff({ id: staffDocSnap.id, ...staffDocSnap.data() } as Staff);
            }
          }
          
          await updateDoc(userDocRef, { lastLoginAt: serverTimestamp() });
        } else {
          setIsOnboarded(false);
          setAppUser(null);
          setStaff(null);
        }
      } else {
        setIsOnboarded(false);
        setAppUser(null);
        setStaff(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [auth, firestore, devMode]);

  const setDevMode = (isDev: boolean) => {
    try {
      sessionStorage.setItem('shareat-hub-dev-mode', String(isDev));
    } catch (e) {
      // sessionStorage not available
    }
    setDevModeState(isDev);
    if(isDev) {
        setIsOnboarded(true);
    }
  };

  return (
    <AuthContext.Provider value={{ user, appUser, staff, loading, isOnboarded, devMode, setDevMode }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthContextProvider');
  }
  return context;
};
