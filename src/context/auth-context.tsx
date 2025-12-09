
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useAuth, useFirestore } from '@/firebase';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isOnboarded: boolean;
  devMode: boolean;
  setDevMode: (isDev: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEV_MODE_KEY = 'shareat-hub-dev-mode';

export const AuthContextProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
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
        // User is logged in, check if they have a corresponding 'users' document
        const userDocRef = doc(firestore, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          setIsOnboarded(true);
          // Update last login time in the background
          await updateDoc(userDocRef, { lastLoginAt: serverTimestamp() });
        } else {
          setIsOnboarded(false);
        }
      } else {
        // User is logged out
        setIsOnboarded(false);
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
    <AuthContext.Provider value={{ user, loading, isOnboarded, devMode, setDevMode }}>
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
