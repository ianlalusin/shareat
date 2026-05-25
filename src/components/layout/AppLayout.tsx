
'use client';

import { useAuthContext, AppUser } from '@/context/auth-context';
import { User as FirebaseUser } from "firebase/auth";
import Header from '@/components/layout/header';
import { useStoreContext } from '@/context/store-context';
import { useLocalProfile } from '@/context/local-profile-context';
import { bypassesLocalUserGate } from '@/lib/server-profiles/localGate';
import { ServerSignInGate } from '@/components/server/ServerSignInGate';

// This is a helper function to merge FirebaseUser and AppUser
function combineUser(
  firebaseUser: FirebaseUser | null,
  appUser: AppUser | null
): AppUser | null {
  if (!firebaseUser) return null;
  if (!appUser) {
      // If there's a Firebase user but no app user yet, it might be the initial moments
      // of sign-up or a loading state. We can create a partial user.
      return {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          username: firebaseUser.email ?? firebaseUser.uid,
          status: 'pending', // Assume pending until Firestore doc loads
      };
  }
  
  return {
    ...appUser,
    uid: firebaseUser.uid,
    email: appUser?.email ?? firebaseUser.email,
    displayName: firebaseUser.displayName || appUser?.displayName || appUser?.name,
    photoURL: firebaseUser.photoURL || appUser?.photoURL,
  };
}


export function AppLayout({ children }: { children: React.ReactNode }) {
    const { user, appUser } = useAuthContext();
    const { activeStore } = useStoreContext();
    const { currentProfile } = useLocalProfile();
    const combinedUser = combineUser(user, appUser);

    // This component now *only* renders if the user is authenticated and active.
    // The decision to render it is made by FirstLoginGuard.
    if (!combinedUser) return null; // Or a loader, but the guard should handle loading state.

    // App-wide local-user gate: every role except admin/manager must be signed
    // into a local user account before using any page, so shared-account actions
    // are always attributed. Admins/managers are attributed by their own account.
    const needsLocalUser = !bypassesLocalUserGate(appUser) && !!activeStore && !currentProfile;

    return (
        <div className="flex min-h-screen w-full flex-col">
            <Header user={combinedUser as any} />
            <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8 mt-14">
                {needsLocalUser ? (
                    <ServerSignInGate
                        title="Sign in as a local user"
                        description="Pick your local user account to use this device. Your actions are recorded under your name."
                    />
                ) : (
                    children
                )}
            </main>
        </div>
    );
}
