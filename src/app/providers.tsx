
"use client";

import { AuthContextProvider, useAuthContext } from '@/context/auth-context';
import { FirstLoginGuard } from '@/components/auth/first-login-guard';
import { StoreContextProvider } from '@/context/store-context';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import Header from '@/components/layout/header';
import { AppUser } from '@/context/auth-context';
import { User as FirebaseUser } from "firebase/auth";

// This is a helper function to merge FirebaseUser and AppUser
function combineUser(
  firebaseUser: FirebaseUser | null,
  appUser: AppUser | null
): AppUser | null {
  if (!firebaseUser || !appUser) return null;
  
  return {
    ...appUser,
    uid: firebaseUser.uid,
    email: appUser?.email ?? null,
    displayName: firebaseUser.displayName || appUser?.displayName || appUser?.name,
    photoURL: firebaseUser.photoURL || appUser?.photoURL,
    status: appUser?.status || "pending",
  };
}

function AppWithLayout({ children }: { children: React.ReactNode }) {
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


export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <FirebaseClientProvider>
            <AuthContextProvider>
                <StoreContextProvider>
                    <FirstLoginGuard>
                        <AppWithLayout>
                            {children}
                        </AppWithLayout>
                    </FirstLoginGuard>
                </StoreContextProvider>
            </AuthContextProvider>
        </FirebaseClientProvider>
    );
}
