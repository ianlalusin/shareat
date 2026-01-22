
"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User as FirebaseUser, getIdTokenResult } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";

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
};

const AuthContext = createContext<AuthCtx | undefined>(undefined);

export function AuthContextProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAppUser(null);

      if (!u) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const staffDocRef = doc(db, "staff", u.uid);

      const unsubUser = onSnapshot(
        staffDocRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            
            // Set isPlatformAdmin based on the role in the database document.
            const isPlatformAdmin = data.role === 'admin';

            const baseAppUser: AppUser = {
              uid: u.uid,
              email: u.email,
              displayName: u.displayName || data.name,
              photoURL: u.photoURL || data.photoURL,
              ...data,
              isPlatformAdmin, // Add the flag based on DB role
            };
            
            setAppUser(baseAppUser);
            
          } else {
            // No staff doc exists, so definitely not an admin.
            setAppUser({ 
              uid: u.uid, 
              email: u.email, 
              displayName: u.displayName, 
              photoURL: u.photoURL, 
              status: "needs_profile",
              isPlatformAdmin: false, // Set to false
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

  const value = useMemo(() => ({ user, appUser, loading }), [user, appUser, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthContextProvider");
  return ctx;
}
