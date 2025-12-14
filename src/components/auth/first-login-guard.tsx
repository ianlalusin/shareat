
"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFirestore } from "@/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import type { Staff } from "@/lib/types";
import { useAuthContext } from "@/context/auth-context";
import { Skeleton } from "../ui/skeleton";
import { useOnboardingStore } from "@/store/use-onboarding-store";
import { getDefaultRouteForRole } from "@/lib/utils";

export function FirstLoginGuard({ children }: { children: ReactNode }) {
  const { user, appUser, isInitialAuthLoading, isOnboarded, devMode } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();
  const [hasRedirected, setHasRedirected] = useState(false);

  useEffect(() => {
    if (isInitialAuthLoading || hasRedirected) {
      return; 
    }

    // Not logged in
    if (!user && !devMode) {
      const isPublicPath = pathname.startsWith('/login') || pathname.startsWith('/onboarding');
      if (!isPublicPath) {
        router.replace("/login");
        setHasRedirected(true);
      }
      return;
    }

    // Logged in AND fully onboarded
    if (isOnboarded && appUser?.role) {
      const isGenericPublicPage = pathname === '/login' || pathname.startsWith('/onboarding') || pathname === '/';
      if (isGenericPublicPage) {
        const defaultRoute = getDefaultRouteForRole(appUser.role);
        router.replace(defaultRoute);
        setHasRedirected(true);
      }
    }
    
  }, [isInitialAuthLoading, user, appUser, isOnboarded, devMode, router, pathname, hasRedirected]);

  if (isInitialAuthLoading) {
    return (
      <div className="flex h-svh w-full items-center justify-center">
        <div className="w-full max-w-md space-y-4 p-4">
          <p className="text-center text-muted-foreground">Checking your account...</p>
          <Skeleton className="h-16 w-16 mx-auto rounded-full" />
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  // User is authenticated, but not onboarded yet. Show the onboarding flow.
  if (user && !isOnboarded && !devMode) {
    // Only render the onboarding manager if we are not already on an onboarding page.
    const isOnboardingPath = pathname.startsWith('/onboarding');
    return isOnboardingPath ? children : <OnboardingFlowManager />;
  }

  // User is onboarded, show the protected content.
  if (isOnboarded) {
    return <>{children}</>;
  }
  
  // Allow access to public pages if not logged in
  if (!user && (pathname.startsWith('/login') || pathname.startsWith('/onboarding'))) {
    return <>{children}</>;
  }

  // Fallback for dev mode when no user is logged in but trying to access protected routes
  if (devMode) {
    return <>{children}</>;
  }

  return null; // Should not be reached in most cases
}

function OnboardingFlowManager() {
    const { user, devMode } = useAuthContext();
    const firestore = useFirestore();
    const router = useRouter();
    const { setStaffToVerify, setStaffListToResolve } = useOnboardingStore();

  useEffect(() => {
    if (devMode) {
      router.replace('/admin');
      return;
    }
    if (!user || !firestore) return;

    const checkStatusAndRedirect = async () => {
      // Has this user already applied and is pending?
      const pendingQ = query(
        collection(firestore, "pendingAccounts"),
        where("uid", "==", user.uid),
        where("status", "==", "pending")
      );
      const pendingSnap = await getDocs(pendingQ);
      if (!pendingSnap.empty) {
        router.replace("/onboarding/pending");
        return;
      }

      // Does this user's email match an existing staff record that isn't linked?
      if (user.email) {
        const staffQ = query(
          collection(firestore, "staff"),
          where("email", "==", user.email),
          where("employmentStatus", "==", "Active")
        );
        const staffSnap = await getDocs(staffQ);
        const staffList = staffSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Staff) })
        ).filter(s => !s.authUid); // Critically, only consider unlinked staff

        if (staffList.length === 1) {
            setStaffToVerify(staffList[0]);
            router.replace('/onboarding/verify');
        } else if (staffList.length > 1) {
            setStaffListToResolve(staffList);
            router.replace('/onboarding/resolve');
        } else {
            // No unlinked staff found by email, user must apply.
            router.replace("/onboarding/apply");
        }
      } else {
           // User has no email, they must apply.
           router.replace("/onboarding/apply");
      }
    };

    checkStatusAndRedirect();

  }, [user, firestore, devMode, router, setStaffToVerify, setStaffListToResolve]);
    
    return (
         <div className="flex h-svh w-full items-center justify-center">
            <p className="text-center text-muted-foreground">Redirecting to onboarding...</p>
         </div>
    );
}
