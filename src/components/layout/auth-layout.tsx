
"use client";

import { useAuthContext } from "@/context/auth-context";
import Header from "./header";
import { AppUser } from "@/context/auth-context";
import { User as FirebaseUser } from "firebase/auth";

// This is a helper function to merge FirebaseUser and AppUser
function combineUser(
  firebaseUser: FirebaseUser | null,
  appUser: AppUser | null
): AppUser | null {
  if (!firebaseUser) return null;
  return {
    // Start with default/fallback values
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    role: "pending",
    status: "pending",
    // Spread the Firestore data, which will override defaults
    ...appUser,
    // Ensure core auth data isn't overwritten by stale Firestore data
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName || appUser?.displayName || appUser?.name,
    photoURL: firebaseUser.photoURL || appUser?.photoURL, 
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (showMainLayout) {
    return (
      <div className="flex min-h-screen w-full flex-col">
        <Header user={combinedUser} />
        <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8 mt-14">
          {children}
        </main>
      </div>
    );
  }

  // For users who are not logged in, pending, or need to create a profile
  return <>{children}</>;
}
