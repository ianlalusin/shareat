
"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";

export type AppUser = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  role?: "admin" | "manager" | "cashier" | "kitchen" | "server";
  roles?: string[];
  status?: "active" | "pending" | "disabled" | "needs_profile";
  storeId?: string | null;
  assignedStoreIds?: string[];
  name?: string;
  contactNumber?: string;
  address?: string;
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
      const ref = doc(db, "staff", u.uid);

      const unsubUser = onSnapshot(
        ref,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            
            const baseAppUser: AppUser = {
              uid: u.uid,
              email: u.email,
              displayName: u.displayName || data.name,
              photoURL: u.photoURL || data.photoURL,
              ...data,
            };
            
            if (data.storeId) {
              const storeStaffRef = doc(db, "stores", data.storeId, "staff", u.uid);
              getDoc(storeStaffRef).then(staffSnap => {
                const finalAppUser = {...baseAppUser};
                if (staffSnap.exists()) {
                    const staffData = staffSnap.data();
                    finalAppUser.role = staffData.role;
                    finalAppUser.roles = [staffData.role];
                }
                setAppUser(finalAppUser);
              }).catch(err => {
                console.error("Failed to fetch store-specific role:", err);
                setAppUser(baseAppUser);
              }).finally(() => {
                setLoading(false);
              });
            } else {
               setAppUser(baseAppUser);
               setLoading(false);
            }
            
          } else {
            setAppUser({ uid: u.uid, email: u.email, displayName: u.displayName, photoURL: u.photoURL, status: "needs_profile" });
            setLoading(false);
          }
        },
        () => {
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
