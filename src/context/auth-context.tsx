
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, User as FirebaseAuthUser } from 'firebase/auth';
import { useAuth, useFirestore } from '@/firebase';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { User as AppUser, Staff } from '@/lib/types';

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

const DEV_MODE_KEY = 'shareat-hub-dev-mode';

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
    try {
      const devModeStatus = sessionStorage.getItem(DEV_MODE_KEY);
      if (devModeStatus === 'true') {
        setDevModeState(true);
        setIsOnboarded(true); // Assume dev is always onboarded
      }
    } catch (e) {
      // sessionStorage not available
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (devMode) {
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
          
          // Update last login time in the background
          await updateDoc(userDocRef, { lastLoginAt: serverTimestamp() });
        } else {
          setIsOnboarded(false);
          setAppUser(null);
          setStaff(null);
        }
      } else {
        // User is logged out
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
      sessionStorage.setItem(DEV_MODE_KEY, String(isDev));
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
