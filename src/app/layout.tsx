
'use client';

import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';
import { Baloo_2, Poppins } from 'next/font/google';
import { cn } from '@/lib/utils';
import { Providers } from './providers';
import { useAuthContext } from '@/context/auth-context';
import Header from '@/components/layout/header';
import { AppUser } from '@/context/auth-context';
import { User as FirebaseUser } from "firebase/auth";

// Define fonts
const fontSans = Poppins({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ['400', '500', '600', '700']
})

const fontSerif = Baloo_2({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ['400', '700']
})

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


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable,
          fontSerif.variable
        )}
      >
        <Providers>
          <AppWithLayout>
            {children}
          </AppWithLayout>
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
