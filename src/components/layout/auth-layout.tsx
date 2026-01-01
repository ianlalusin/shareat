
"use client";

import { useAuthContext } from "@/context/auth-context";
import Header from "./header";
import { AppUser } from "@/context/auth-context";
import { User as FirebaseUser } from "firebase/auth";
import { BrandLoader } from "@/components/ui/BrandLoader";

// This is a helper function to merge FirebaseUser and AppUser
function combineUser(
  firebaseUser: FirebaseUser | null,
  appUser: AppUser | null
): AppUser | null {
  if (!firebaseUser || !appUser) return null;
  
  // Spread the Firestore data first, then override with fresh auth data.
  // This ensures uid, email, etc., are always from the source of truth (Firebase Auth)
  // while retaining other Firestore-specific fields like role and status.
  return {
    ...appUser,
    uid: firebaseUser.uid,
    email: appUser?.email ?? null,
    displayName: firebaseUser.displayName || appUser?.displayName || appUser?.name,
    photoURL: firebaseUser.photoURL || appUser?.photoURL,
    status: appUser?.status || "pending", // Ensure status has a fallback
  };
}


export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, appUser, loading } = useAuthContext();
  const combinedUser = combineUser(user, appUser);

  // This check prevents showing the main layout for unauthenticated users
  // which solves layout flashes and keeps login/signup pages clean.
  const showMainLayout = !loading && combinedUser && combinedUser.status === 'active';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
      </div>
    );
  }

  if (showMainLayout) {
    return (
      <div className="flex min-h-screen w-full flex-col">
        <Header user={combinedUser as any} />
        <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8 mt-14">
          {children}
        </main>
      </div>
    );
  }

  // For users who are not logged in, pending, or need to create a profile
  return <>{children}</>;
}
