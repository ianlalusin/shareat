
'use client';

import { useAuthContext, AppUser } from '@/context/auth-context';
import { User as FirebaseUser } from "firebase/auth";
import Header from '@/components/layout/header';

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
    const { user, appUser, loading } = useAuthContext();
    const combinedUser = combineUser(user, appUser);

    const showMainLayout = !loading && combinedUser && combinedUser.status === 'active';

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
    
    // For users who are not logged in, pending, etc.
    return <>{children}</>;
}
