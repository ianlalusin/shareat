
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseAuthUser } from 'firebase/auth';
import { useAuth, useFirestore } from '@/firebase';
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc, query, collection, where, getDocs, setDoc, limit, Unsubscribe } from 'firebase/firestore';
import type { AppUser, Staff, Store, StaffRole } from '@/lib/types';
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

const ALLOWED_ROLES: StaffRole[] = ['admin', 'manager', 'cashier', 'server', 'kitchen'];

function isValidRole(role?: string): role is StaffRole {
    if (!role) return false;
    const lowerCaseRole = role.toLowerCase();
    return ALLOWED_ROLES.some(allowedRole => allowedRole === lowerCaseRole);
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
        const staffQuery = query(collection(firestore, 'staff'), where('authUid', '==', currentUser.uid), limit(1));
        const staffSnapshot = await getDocs(staffQuery);
        const staffDoc = staffSnapshot.empty ? null : staffSnapshot.docs[0];
        const staffData = staffDoc ? { id: staffDoc.id, ...staffDoc.data() } as Staff : null;
        
        if (staffData && isStaffActive(staffData) && isValidRole(staffData.position)) {
            setStaff(staffData);

            let derivedStoreIds: string[] = [];
            if (Array.isArray(staffData.storeIds) && staffData.storeIds.length > 0) {
              derivedStoreIds = staffData.storeIds;
            } else if ((staffData as any).storeId) {
                // Fallback to legacy single storeId
                derivedStoreIds = [(staffData as any).storeId];
            } else if (staffData.assignedStore) {
              const storeQ = query(collection(firestore, 'stores'), where('storeName', '==', staffData.assignedStore), limit(1));
              const storeSnap = await getDocs(storeQ);
              if (!storeSnap.empty) derivedStoreIds = [storeSnap.docs[0].id];
            }

            const defaultStoreId = staffData.defaultStoreId && derivedStoreIds.includes(staffData.defaultStoreId)
              ? staffData.defaultStoreId
              : derivedStoreIds[0] || null;
              
            const userDocRef = doc(firestore, 'users', currentUser.uid);
            const userDocSnap = await getDoc(userDocRef);
            const currentAppUser = userDocSnap.data() as AppUser | undefined;

            let activeStoreId = currentAppUser?.activeStoreId && derivedStoreIds.includes(currentAppUser.activeStoreId)
              ? currentAppUser.activeStoreId
              : defaultStoreId;
            
            const activeStoreDoc = activeStoreId ? await getDoc(doc(firestore, 'stores', activeStoreId)) : null;

            const userPayload = {
                staffId: staffData.id,
                email: currentUser.email!,
                displayName: staffData.fullName,
                role: staffData.position.toLowerCase() as StaffRole,
                storeId: activeStoreId || '', // legacy field
                storeName: activeStoreDoc?.data()?.storeName || '',
                storeIds: derivedStoreIds,
                activeStoreId: activeStoreId,
                status: 'active',
            };
            
            const needsUpdate = !currentAppUser ||
                                JSON.stringify(userPayload.staffId) !== JSON.stringify(currentAppUser.staffId) ||
                                JSON.stringify(userPayload.email) !== JSON.stringify(currentAppUser.email) ||
                                JSON.stringify(userPayload.displayName) !== JSON.stringify(currentAppUser.displayName) ||
                                JSON.stringify(userPayload.role) !== JSON.stringify(currentAppUser.role) ||
                                JSON.stringify(userPayload.storeId) !== JSON.stringify(currentAppUser.storeId) ||
                                JSON.stringify(userPayload.storeName) !== JSON.stringify(currentAppUser.storeName) ||
                                JSON.stringify(userPayload.storeIds) !== JSON.stringify(currentAppUser.storeIds) ||
                                JSON.stringify(userPayload.activeStoreId) !== JSON.stringify(currentAppUser.activeStoreId) ||
                                JSON.stringify(userPayload.status) !== JSON.stringify(currentAppUser.status);


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
              if (snap.exists()) {
                const updatedAppUser = {id: snap.id, ...snap.data()} as AppUser;
                setAppUser(updatedAppUser);
                setSelectedStoreId(updatedAppUser.activeStoreId || null);
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
    const newStoreDoc = await getDoc(doc(firestore, 'stores', storeId));

    await updateDoc(userRef, {
      activeStoreId: storeId,
      storeId: storeId,
      storeName: newStoreDoc.data()?.storeName || '',
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
