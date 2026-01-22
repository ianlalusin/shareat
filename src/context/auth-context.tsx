
"use client";

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { onAuthStateChanged, User as FirebaseUser, signOut as firebaseSignOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
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
  isSigningOut: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx | undefined>(undefined);

export function AuthContextProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAppUser(null);
      setLoading(true);

      if (!u) {
        setLoading(false);
        return;
      }

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
            setAppUser({ 
              uid: u.uid, 
              email: u.email, 
              displayName: u.displayName, 
              photoURL: u.photoURL, 
              status: "needs_profile",
              isPlatformAdmin: false,
            });
          }
          setLoading(false);
        },
        (error) => {
          console.error("AuthContext: Error listening to staff document:", error);
          setLoading(false);
          setAppUser(null);
        }
      );

      return () => unsubUser();
    });

    return () => unsubAuth();
  }, []);

  const signOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await firebaseSignOut(auth);
      router.push('/login');
    } catch (error) {
      console.error("Sign out failed", error);
      setIsSigningOut(false);
    }
  }, [router]);

  const value = useMemo(() => ({ user, appUser, loading, isSigningOut, signOut }), [user, appUser, loading, isSigningOut, signOut]);
  
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthContextProvider");
  return ctx;
}
