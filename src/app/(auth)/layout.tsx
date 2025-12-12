
'use client';

import { useAuthContext } from "@/context/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isInitialAuthLoading, devMode } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!isInitialAuthLoading && (user || devMode)) {
      router.push('/admin');
    }
  }, [user, isInitialAuthLoading, devMode, router]);

  if(isInitialAuthLoading || user || devMode) {
    return (
        <div className="flex h-svh w-full items-center justify-center">
            <div className="w-full max-w-md space-y-4 p-4">
                <Skeleton className="h-16 w-16 mx-auto rounded-full" />
                <Skeleton className="h-8 w-48 mx-auto" />
                <Skeleton className="h-40 w-full" />
            </div>
        </div>
    );
  }

  return (
    <main className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-4">
      {children}
    </main>
  );
}
