
"use client";

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { onAuthStateChanged, User as FirebaseUser, signOut as firebaseSignOut } from "firebase/auth";
import { doc, onSnapshot, FirestoreError } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
import { useRouter } from "next/navigation";

export type AppUser = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  role?: "admin" | "manager" | "cashier" | "kitchen" | "server";
  roles?: string[];
  status?: "active" | "pending" | "disabled" | "needs_profile";
  assignedStoreIds?: string[];
  name?: string;
  contactNumber?: string;
  address?: string;
  isPlatformAdmin?: boolean;
};

type AuthCtx = {
  user: FirebaseUser | null;
  appUser: AppUser | null;
  loading: boolean;
  authLoading: boolean;
  staffLoading: boolean;
  staffError: Error | null;
  isSigningOut: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx | undefined>(undefined);

export function AuthContextProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  
  const [authLoading, setAuthLoading] = useState(true);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState<Error | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAppUser(null);
      setAuthLoading(false); // Firebase auth state is now resolved.
      setStaffError(null);
      
      if (!u) {
        setStaffLoading(false); // No user, so no staff profile to load.
        return;
      }
      
      // User is authenticated, now fetch their staff profile.
      setStaffLoading(true);

      const staffDocRef = doc(db, "staff", u.uid);
      const unsubUser = onSnapshot(
        staffDocRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            const isPlatformAdmin = data.role === 'admin';
            const baseAppUser: AppUser = {
              uid: u.uid,
              email: u.email,
              displayName: u.displayName || data.name,
              photoURL: u.photoURL || data.photoURL,
              ...data,
              isPlatformAdmin,
            };
            setAppUser(baseAppUser);
          } else {
            // User exists in Firebase Auth, but no staff doc found.
            // This is the "needs_profile" state for new sign-ups.
            setAppUser({ 
              uid: u.uid, 
              email: u.email, 
              displayName: u.displayName, 
              photoURL: u.photoURL, 
              status: "needs_profile",
              isPlatformAdmin: false,
            });
          }
          setStaffLoading(false); // Staff profile loaded successfully.
          setStaffError(null);
        },
        (error: FirestoreError) => {
          console.error("AuthContext: Error listening to staff document:", error);
          setStaffLoading(false); // Staff profile failed to load.
          setStaffError(error); // Store the error.
          setAppUser(null); // Ensure appUser is null on error.
        }
      );
      
      // Return the unsubscribe function for the staff listener.
      return () => unsubUser();
    });

    // Return the unsubscribe function for the auth state listener.
    return () => unsubAuth();
  }, []);

  const signOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await firebaseSignOut(auth);
      router.push('/login');
    } catch (error) {
      console.error("Sign out failed", error);
    } finally {
      setIsSigningOut(false);
    }
  }, [router]);

  const loading = authLoading || (!!user && staffLoading);

  const value = useMemo(() => ({ 
    user, 
    appUser, 
    loading, 
    authLoading, 
    staffLoading, 
    staffError, 
    isSigningOut, 
    signOut 
  }), [user, appUser, loading, authLoading, staffLoading, staffError, isSigningOut, signOut]);
  
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthContextProvider");
  return ctx;
}
