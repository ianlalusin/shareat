
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
      if (devModeStatus === null) {
        // Default to dev mode if nothing is set
        setDevModeState(true);
        sessionStorage.setItem(DEV_MODE_KEY, 'true');
      } else {
        setDevModeState(devModeStatus === 'true');
      }
    } catch (e) {
      // sessionStorage not available, default to dev mode for this session
      setDevModeState(true);
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

// This component protects routes that require authentication
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading, devMode } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user && !devMode) {
      router.push('/login');
    }
  }, [user, loading, devMode, router]);
  
  // Show a loading state while we check for authentication
  if (loading || (!user && !devMode && pathname !== '/login')) {
    return (
        <div className="flex h-svh w-full items-center justify-center">
            <div className="w-full max-w-md space-y-4 p-4">
                <Skeleton className="h-16 w-16 mx-auto rounded-full" />
                <Skeleton className="h-8 w-48 mx-auto" />
                <Skeleton className="h-40 w-full" />
            </div>
        </div>
    );
  }
  
  // If user is authenticated or in dev mode, render the children
  if (user || devMode) {
    return <>{children}</>;
  }
  
  // Fallback for edge cases, though the useEffect should handle redirection
  return null;
};
