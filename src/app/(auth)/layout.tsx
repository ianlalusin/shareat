
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
  const { user, loading, devMode } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (user || devMode)) {
      router.push('/admin');
    }
  }, [user, loading, devMode, router]);

  if(loading || user || devMode) {
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
