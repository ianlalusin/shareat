
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseAuthUser } from 'firebase/auth';
import { useAuth, useFirestore } from '@/firebase';
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc, query, collection, where, getDocs, setDoc, limit, Unsubscribe } from 'firebase/firestore';
import type { AppUser, Staff, Store } from '@/lib/types';
import { useStoreSelector } from '@/store/use-store-selector';

interface AuthContextType {
  user: FirebaseAuthUser | null;
  appUser: AppUser | null;
  staff: Staff | null;
  isActiveStaff: boolean;
  isInitialAuthLoading: boolean;
  isOnboarded: boolean;
  devMode: boolean;
  setDevMode: (isDev: boolean) => void;
  setActiveStoreId: (storeId: string) => Promise<void>;
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
  const { setSelectedStoreId } = useStoreSelector();

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
        setSelectedStoreId(null);
        setIsInitialAuthLoading(false);
        return;
      }
      
      setIsInitialAuthLoading(true);

      try {
        // 1. Find the canonical staff record via authUid
        const staffQuery = query(collection(firestore, 'staff'), where('authUid', '==', currentUser.uid), limit(1));
        const staffSnapshot = await getDocs(staffQuery);
        const staffDoc = staffSnapshot.empty ? null : staffSnapshot.docs[0];
        const staffData = staffDoc ? { id: staffDoc.id, ...staffDoc.data() } as Staff : null;
        
        if (staffData && isStaffActive(staffData)) {
            setStaff(staffData);
            
            // 2. Derive storeIds (with backward compatibility)
            let derivedStoreIds: string[] = [];
            if (Array.isArray(staffData.storeIds) && staffData.storeIds.length > 0) {
              derivedStoreIds = staffData.storeIds;
            } else if (staffData.assignedStore) {
              const storeQ = query(collection(firestore, 'stores'), where('storeName', '==', staffData.assignedStore), limit(1));
              const storeSnap = await getDocs(storeQ);
              if (!storeSnap.empty) derivedStoreIds = [storeSnap.docs[0].id];
            }

            // 3. Determine default and active store IDs
            const defaultStoreId = staffData.defaultStoreId && derivedStoreIds.includes(staffData.defaultStoreId)
              ? staffData.defaultStoreId
              : derivedStoreIds[0] || null;
              
            const userDocRef = doc(firestore, 'users', currentUser.uid);
            const userDocSnap = await getDoc(userDocRef);
            const currentAppUser = userDocSnap.data() as AppUser | undefined;

            let activeStoreId = currentAppUser?.activeStoreId && derivedStoreIds.includes(currentAppUser.activeStoreId)
              ? currentAppUser.activeStoreId
              : defaultStoreId;
            
            // 4. Construct the canonical AppUser payload
            const activeStoreDoc = activeStoreId ? await getDoc(doc(firestore, 'stores', activeStoreId)) : null;

            const userPayload: Omit<AppUser, 'id' | 'createdAt' | 'lastLoginAt'> = {
                staffId: staffData.id,
                email: currentUser.email!,
                displayName: staffData.fullName,
                role: staffData.position?.toLowerCase() as AppUser['role'] || 'staff',
                storeId: activeStoreId || '', // Legacy compatibility
                storeName: activeStoreDoc?.data()?.storeName || '',
                storeIds: derivedStoreIds,
                activeStoreId: activeStoreId,
                status: 'active',
            };
            
            // 5. No-churn update/set of the user document
            const needsUpdate = !currentAppUser ||
                                JSON.stringify(userPayload) !== JSON.stringify({
                                    staffId: currentAppUser.staffId,
                                    email: currentAppUser.email,
                                    displayName: currentAppUser.displayName,
                                    role: currentAppUser.role,
                                    storeId: currentAppUser.storeId,
                                    storeName: currentAppUser.storeName,
                                    storeIds: currentAppUser.storeIds,
                                    activeStoreId: currentAppUser.activeStoreId,
                                    status: currentAppUser.status,
                                });

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

            // 6. Set up a snapshot listener for the user doc and sync active store
            userDocUnsubscribe = onSnapshot(userDocRef, (snap) => {
              if (snap.exists()) {
                const updatedAppUser = snap.data() as AppUser;
                setAppUser(updatedAppUser);
                setSelectedStoreId(updatedAppUser.activeStoreId || null); // Sync with Zustand
              }
            });

            setIsOnboarded(true);
            
            try {
              await updateDoc(doc(firestore, 'staff', staffData.id), { lastLoginAt: serverTimestamp() });
            } catch (e) { console.warn("Staff lastLoginAt update skipped", e); }

        } else {
            setIsOnboarded(false);
            setAppUser(null);
            setStaff(null);
            setSelectedStoreId(null);
        }
      } catch (error) {
        console.error("Error during auth state processing:", error);
        setIsOnboarded(false);
        setAppUser(null);
        setStaff(null);
        setSelectedStoreId(null);
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
  }, [auth, firestore, setSelectedStoreId]);

  const setDevMode = (isDev: boolean) => {
    setDevModeState(isDev);
    if(isDev) {
        setIsOnboarded(true);
    }
  };

  const setActiveStoreId = async (storeId: string) => {
    if (!user || !appUser || !firestore || !isActiveStaff) {
      throw new Error("Cannot change store: user not fully authenticated.");
    }
    if (appUser.role !== 'admin' && !appUser.storeIds?.includes(storeId)) {
      throw new Error("You do not have permission to access this store.");
    }

    const userRef = doc(firestore, 'users', user.uid);
    // This will trigger the onSnapshot listener to update the context state
    await updateDoc(userRef, {
      activeStoreId: storeId,
      storeId: storeId, // for legacy compat
    });
  };

  return (
    <AuthContext.Provider value={{ user, appUser, staff, isActiveStaff, isInitialAuthLoading, isOnboarded, devMode, setDevMode, setActiveStoreId }}>
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
