
'use client';

import { useAuthContext } from "@/context/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { FirstLoginGuard } from "@/components/auth/first-login-guard";
import PublicLayout from "../(public)/layout";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isInitialAuthLoading, user, isOnboarded } = useAuthContext();
  
  const showLoadingState = isInitialAuthLoading || (user && !isOnboarded);

  // If we are checking auth, or the user is logged in but hasn't completed onboarding,
  // show a loading state. FirstLoginGuard will handle the logic inside.
  if (showLoadingState) {
    return (
       <FirstLoginGuard>
          <PublicLayout>
            <div className="flex h-svh w-full items-center justify-center bg-muted/40 p-4">
                <div className="w-full max-w-md space-y-4 p-4 text-center">
                    <Skeleton className="h-16 w-16 mx-auto rounded-full" />
                    <p className="text-muted-foreground animate-pulse">Verifying account...</p>
                    <Skeleton className="h-8 w-48 mx-auto" />
                    <Skeleton className="h-40 w-full" />
                </div>
            </div>
          </PublicLayout>
       </FirstLoginGuard>
    );
  }

  // If we are here, the user is not logged in.
  // The actual login form is now in the (public) group, so this layout's children will be empty.
  // We can render a fallback or just an empty fragment.
  return <>{children}</>;
}
