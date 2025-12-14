
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseAuthUser } from 'firebase/auth';
import { useAuth, useFirestore } from '@/firebase';
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc, query, collection, where, limit } from 'firebase/firestore';
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

const isStaffActive = (staffData: Staff | null): boolean => {
  if (!staffData) return false;
  const status = staffData.employmentStatus?.toLowerCase();
  // @ts-ignore
  const isActiveBool = staffData.is_active === true;
  return status === 'active' || isActiveBool;
}

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
  
      if (!currentUser) {
        setIsOnboarded(false);
        setAppUser(null);
        setStaff(null);
        setIsInitialAuthLoading(false);
        return;
      }
      
      // The user is authenticated, now determine their app status.
      setIsInitialAuthLoading(true);

      try {
        // Step 1: Prioritize lookup by authUid in staff collection.
        const staffQuery = query(
          collection(firestore, 'staff'),
          where('authUid', '==', currentUser.uid),
          limit(1)
        );
        const staffSnapshot = await getDocs(staffQuery);

        if (!staffSnapshot.empty) {
          const staffDoc = staffSnapshot.docs[0];
          const staffData = { id: staffDoc.id, ...staffDoc.data() } as Staff;
          
          if (isStaffActive(staffData)) {
            setStaff(staffData);
            
            // Sync user doc
            const userDocRef = doc(firestore, 'users', currentUser.uid);
            const userDocSnap = await getDoc(userDocRef);
            const userPayload = {
              staffId: staffData.id,
              email: currentUser.email,
              displayName: staffData.fullName,
              role: staffData.position?.toLowerCase() || 'staff',
            }

            if (!userDocSnap.exists()) {
               await setDoc(userDocRef, { ...userPayload, createdAt: serverTimestamp(), status: 'active' }, { merge: true });
            } else {
               await updateDoc(userDocRef, userPayload);
            }
            
            // Listen to user doc for role changes etc.
            onSnapshot(userDocRef, (snap) => {
              if (snap.exists()) setAppUser(snap.data() as AppUser);
            });
            
            setIsOnboarded(true);

            // Safe last login update
            try {
              await updateDoc(userDocRef, { lastLoginAt: serverTimestamp() });
            } catch (e) { console.warn("Failed to update last login time:", e) }

            return; // Exit early, user is verified
          }
        }
        
        // Step 2: Fallback for users who might have a `users` doc but no linked active staff.
        // This is the path for new users, or users whose linked staff became inactive.
        setIsOnboarded(false);
        setAppUser(null);
        setStaff(null);

      } catch (error) {
        console.error("Error during auth state processing:", error);
        setIsOnboarded(false);
        setAppUser(null);
        setStaff(null);
      } finally {
        setIsInitialAuthLoading(false);
      }
    });
  
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
