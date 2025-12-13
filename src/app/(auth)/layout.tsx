
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
  const { isInitialAuthLoading, user, devMode } = useAuthContext();
  
  if (isInitialAuthLoading) {
    return (
      <PublicLayout>
        <div className="flex h-svh w-full items-center justify-center bg-muted/40 p-4">
            <div className="w-full max-w-md space-y-4 p-4">
                <Skeleton className="h-16 w-16 mx-auto rounded-full" />
                <Skeleton className="h-8 w-48 mx-auto" />
                <Skeleton className="h-40 w-full" />
            </div>
        </div>
      </PublicLayout>
    );
  }
  
  // If the user is logged in and onboarded, FirstLoginGuard will handle redirecting to the main app.
  // We don't want to show the login form again.
  if (user) {
    return <FirstLoginGuard>{children}</FirstLoginGuard>
  }

  // If we are here, the user is not logged in. Show the login/signup forms within the public layout.
  return (
    <PublicLayout>
        <div className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-4">
            {children}
        </div>
    </PublicLayout>
  );
}
