
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseAuthUser } from 'firebase/auth';
import { useAuth, useFirestore } from '@/firebase';
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc, query, collection, where, getDocs, setDoc, limit, Unsubscribe } from 'firebase/firestore';
import type { AppUser, Staff, Store } from '@/lib/types';

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

function isStaffActive(staffData: Staff | null): boolean {
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
  
    let userUnsubscribe: Unsubscribe | null = null;
    
    const authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Clean up previous user's listener
      if (userUnsubscribe) {
        userUnsubscribe();
        userUnsubscribe = null;
      }
      
      setUser(currentUser);
  
      if (!currentUser) {
        setIsOnboarded(false);
        setAppUser(null);
        setStaff(null);
        setIsInitialAuthLoading(false);
        return;
      }
      
      setIsInitialAuthLoading(true);

      try {
        const staffQuery = query(collection(firestore, 'staff'), where('authUid', '==', currentUser.uid), limit(1));
        const staffSnapshot = await getDocs(staffQuery);

        if (!staffSnapshot.empty) {
            const staffDoc = staffSnapshot.docs[0];
            const staffData = { id: staffDoc.id, ...staffDoc.data() } as Staff;

            if (isStaffActive(staffData)) {
                setStaff(staffData);
                
                const userDocRef = doc(firestore, 'users', currentUser.uid);
                
                const storeQuery = query(collection(firestore, 'stores'), where('storeName', '==', staffData.assignedStore), limit(1));
                const storeSnap = await getDocs(storeQuery);
                const storeId = storeSnap.empty ? '' : storeSnap.docs[0].id;

                const userPayload = {
                    staffId: staffData.id,
                    email: currentUser.email,
                    displayName: staffData.fullName,
                    role: staffData.position?.toLowerCase() || 'staff',
                    storeId: storeId,
                    status: 'active',
                };
                
                const userDocSnap = await getDoc(userDocRef);

                if (!userDocSnap.exists()) {
                    await setDoc(userDocRef, { ...userPayload, createdAt: serverTimestamp(), lastLoginAt: serverTimestamp() });
                } else {
                    const currentAppUser = userDocSnap.data() as AppUser;
                    const needsUpdate = userPayload.staffId !== currentAppUser.staffId ||
                                        userPayload.role !== currentAppUser.role ||
                                        userPayload.storeId !== currentAppUser.storeId ||
                                        userPayload.displayName !== currentAppUser.displayName ||
                                        userPayload.email !== currentAppUser.email ||
                                        userPayload.status !== currentAppUser.status;

                    if (needsUpdate) {
                       await updateDoc(userDocRef, { ...userPayload, lastLoginAt: serverTimestamp() });
                    } else {
                        try {
                           await updateDoc(userDocRef, { lastLoginAt: serverTimestamp() });
                        } catch (e) {
                           console.warn('lastLoginAt update skipped', e);
                        }
                    }
                }
                
                userUnsubscribe = onSnapshot(userDocRef, (snap) => {
                  if (snap.exists()) setAppUser(snap.data() as AppUser);
                });
                
                setIsOnboarded(true);

                try {
                  await updateDoc(staffDoc.ref, { lastLoginAt: serverTimestamp() });
                } catch (e) { console.warn("Staff lastLoginAt update skipped", e); }

                setIsInitialAuthLoading(false);
                return;
            }
        }
        
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
  
    return () => {
        authUnsubscribe();
        if (userUnsubscribe) {
          userUnsubscribe();
        }
    };
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

export { isStaffActive };
