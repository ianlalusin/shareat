
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseAuthUser } from 'firebase/auth';
import { useAuth, useFirestore } from '@/firebase';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { AppUser, Staff } from '@/lib/types';

interface AuthContextType {
  user: FirebaseAuthUser | null;
  appUser: AppUser | null;
  staff: Staff | null;
  isInitialAuthLoading: boolean;
  isOnboarded: boolean;
  devMode: boolean;
  setDevMode: (isDev: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthContextProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<FirebaseAuthUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [isInitialAuthLoading, setIsInitialAuthLoading] = useState(true);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [devMode, setDevModeState] = useState(false);
  const auth = useAuth();
  const firestore = useFirestore();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
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
      setIsInitialAuthLoading(false);
    });

    return () => unsubscribe();
  }, [auth, firestore]);

  const setDevMode = (isDev: boolean) => {
    // This is now a simplified stub. You can enhance it later if needed.
    setDevModeState(isDev);
    if(isDev) {
        setIsOnboarded(true);
    }
  };

  return (
    <AuthContext.Provider value={{ user, appUser, staff, isInitialAuthLoading, isOnboarded, devMode, setDevMode }}>
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
