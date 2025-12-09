
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useAuth } from '@/firebase';
import { Skeleton } from '@/components/ui/skeleton';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  devMode: boolean;
  setDevMode: (isDev: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEV_MODE_KEY = 'shareat-hub-dev-mode';

export const AuthContextProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [devMode, setDevModeState] = useState(false);
  const auth = useAuth();
  
  useEffect(() => {
    try {
      const devModeStatus = sessionStorage.getItem(DEV_MODE_KEY);
      setDevModeState(devModeStatus === 'true');
    } catch (e) {
      // sessionStorage not available
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [auth]);

  const setDevMode = (isDev: boolean) => {
    try {
      sessionStorage.setItem(DEV_MODE_KEY, String(isDev));
    } catch (e) {
        // sessionStorage not available
    }
    setDevModeState(isDev);
  }

  return (
    <AuthContext.Provider value={{ user, loading, devMode, setDevMode }}>
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
