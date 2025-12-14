
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseAuthUser } from 'firebase/auth';
import { useAuth, useFirestore } from '@/firebase';
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
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
    if (!auth || !firestore) return;
  
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
  
      if (currentUser) {
        const userDocRef = doc(firestore, 'users', currentUser.uid);
  
        // Using onSnapshot to listen for real-time changes to user/staff docs
        const unsubUser = onSnapshot(userDocRef, async (userDocSnap) => {
          if (userDocSnap.exists()) {
            const appUserData = userDocSnap.data() as AppUser;
            setAppUser(appUserData);
  
            if (appUserData.staffId) {
              const staffDocRef = doc(firestore, 'staff', appUserData.staffId);
              const staffDocSnap = await getDoc(staffDocRef); // Can be getDoc as staff data is less dynamic
              if (staffDocSnap.exists()) {
                const staffData = { id: staffDocSnap.id, ...staffDocSnap.data() } as Staff;
                if (staffData.employmentStatus === 'Active') {
                  setStaff(staffData);
                  setIsOnboarded(true);
                } else {
                  // Linked staff is not active, treat as not onboarded
                  setStaff(null);
                  setIsOnboarded(false);
                }
              } else {
                // staffId exists but staff doc doesn't, not onboarded
                setStaff(null);
                setIsOnboarded(false);
              }
            } else {
              // user doc exists but no staffId, not onboarded
              setStaff(null);
              setIsOnboarded(false);
            }
            
            // Update last login regardless of onboarding status if user doc exists
            await updateDoc(userDocRef, { lastLoginAt: serverTimestamp() });

          } else {
            // User is authenticated but no user document exists.
            // This is a first-time login scenario.
            setIsOnboarded(false);
            setAppUser(null);
            setStaff(null);
          }
          setIsInitialAuthLoading(false);
        }, (error) => {
          console.error("Error listening to user document:", error);
          setIsInitialAuthLoading(false);
        });

        // Detach the listener when the auth state changes
        return () => unsubUser();

      } else {
        // No user is logged in
        setIsOnboarded(false);
        setAppUser(null);
        setStaff(null);
        setIsInitialAuthLoading(false);
      }
    });
  
    // Main auth state listener cleanup
    return () => unsubscribe();
  }, [auth, firestore]);

  const setDevMode = (isDev: boolean) => {
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
