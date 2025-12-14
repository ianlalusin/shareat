
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
  isActiveStaff: boolean;
  isInitialAuthLoading: boolean;
  isOnboarded: boolean;
  devMode: boolean;
  setDevMode: (isDev: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function isStaffActive(staffData: Staff | null): boolean {
  if (!staffData) return false;
  const status = staffData.employmentStatus?.toLowerCase();
  // @ts-ignore Legacy field
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
  const isActiveStaff = isStaffActive(staff);

  useEffect(() => {
    if (!auth || !firestore) return;

    let userDocUnsubscribe: Unsubscribe | null = null;
    
    const authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (userDocUnsubscribe) {
        userDocUnsubscribe();
        userDocUnsubscribe = null;
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
        const userDocRef = doc(firestore, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        const currentAppUser = userDocSnap.data() as AppUser | undefined;

        let staffData: Staff | null = null;
        if (currentAppUser?.staffId) {
            const staffDoc = await getDoc(doc(firestore, 'staff', currentAppUser.staffId));
            if (staffDoc.exists()) {
                staffData = { id: staffDoc.id, ...staffDoc.data() } as Staff;
            }
        }

        if (!staffData) {
            const staffQuery = query(collection(firestore, 'staff'), where('authUid', '==', currentUser.uid), limit(1));
            const staffSnapshot = await getDocs(staffQuery);
            if (!staffSnapshot.empty) {
                const staffDoc = staffSnapshot.docs[0];
                staffData = { id: staffDoc.id, ...staffDoc.data() } as Staff;
            }
        }
        
        if (staffData && isStaffActive(staffData)) {
            setStaff(staffData);

            // Multi-store logic
            let storeIds: string[] = [];
            if (Array.isArray(staffData.storeIds) && staffData.storeIds.length > 0) {
              storeIds = staffData.storeIds;
            } else if(staffData.assignedStore) {
              const storeQ = query(collection(firestore, 'stores'), where('storeName', '==', staffData.assignedStore), limit(1));
              const storeSnap = await getDocs(storeQ);
              if (!storeSnap.empty) storeIds = [storeSnap.docs[0].id];
            }
            
            const defaultStoreId = staffData.defaultStoreId || storeIds[0] || null;
            let activeStoreId = currentAppUser?.activeStoreId && storeIds.includes(currentAppUser.activeStoreId)
              ? currentAppUser.activeStoreId
              : defaultStoreId;
            
            const activeStoreDoc = activeStoreId ? await getDoc(doc(firestore, 'stores', activeStoreId)) : null;

            const userPayload: Omit<AppUser, 'id' | 'createdAt' | 'lastLoginAt'> = {
                staffId: staffData.id,
                email: currentUser.email!,
                displayName: staffData.fullName,
                role: staffData.position?.toLowerCase() as AppUser['role'] || 'staff',
                storeId: activeStoreId || '', // Legacy compatibility
                storeName: activeStoreDoc?.data()?.storeName || '',
                storeIds: storeIds,
                activeStoreId: activeStoreId,
                status: 'active',
            };
            
            const needsUpdate = !currentAppUser ||
                                userPayload.staffId !== currentAppUser.staffId ||
                                userPayload.role !== currentAppUser.role ||
                                userPayload.storeId !== activeStoreId ||
                                userPayload.displayName !== currentAppUser.displayName ||
                                userPayload.email !== currentAppUser.email ||
                                JSON.stringify(userPayload.storeIds) !== JSON.stringify(currentAppUser.storeIds) ||
                                userPayload.activeStoreId !== currentAppUser.activeStoreId ||
                                userPayload.status !== currentAppUser.status;

            if (needsUpdate) {
                 await setDoc(userDocRef, { 
                    ...userPayload, 
                    lastLoginAt: serverTimestamp(),
                    createdAt: currentAppUser?.createdAt || serverTimestamp()
                }, { merge: true });
            } else {
                 try {
                    await updateDoc(userDocRef, { lastLoginAt: serverTimestamp() });
                } catch (e) {
                    console.warn('lastLoginAt update skipped', e);
                }
            }

            userDocUnsubscribe = onSnapshot(userDocRef, (snap) => {
              if (snap.exists()) setAppUser(snap.data() as AppUser);
            });

            setIsOnboarded(true);
            try {
              await updateDoc(doc(firestore, 'staff', staffData.id), { lastLoginAt: serverTimestamp() });
            } catch (e) { console.warn("Staff lastLoginAt update skipped", e); }
        } else {
            setIsOnboarded(false);
            setAppUser(null);
            setStaff(null);
        }
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
        if (userDocUnsubscribe) {
            userDocUnsubscribe();
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
    <AuthContext.Provider value={{ user, appUser, staff, isActiveStaff, isInitialAuthLoading, isOnboarded, devMode, setDevMode }}>
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
