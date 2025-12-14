
"use client";

import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFirestore } from "@/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import type { Staff, StaffRole } from "@/lib/types";
import { useAuthContext } from "@/context/auth-context";
import { Skeleton } from "../ui/skeleton";
import { useOnboardingStore } from "@/store/use-onboarding-store";

type OnboardingStatus =
  | "loading"
  | "ready" // Fully onboarded
  | "existingStaff" // Found one matching staff record
  | "duplicateStaff" // Found multiple matching staff records
  | "applicant" // No staff record, application needed
  | "pendingApproval"; // Applied, waiting for admin
  
const ROLE_REDIRECTS: Record<StaffRole, string> = {
  admin: '/admin',
  manager: '/admin',
  cashier: '/cashier',
  server: '/refill',
  kitchen: '/kitchen',
};

export function FirstLoginGuard({ children }: { children: ReactNode }) {
  const { user, isInitialAuthLoading, isOnboarded, appUser, devMode } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // If auth is still loading, wait.
    if (isInitialAuthLoading) {
      return;
    }

    // If user is not logged in (and not in dev mode), push to login page.
    if (!user && !devMode) {
      // Don't redirect if we are already on a public/auth path
      if (!pathname.startsWith('/login') && !pathname.startsWith('/onboarding')) {
         router.replace("/login");
      }
      return;
    }

    // If the user IS logged in but NOT onboarded yet, let the OnboardingFlowManager handle it.
    // The OnboardingFlowManager will be rendered instead of `children` and perform the necessary redirect.
    if (user && !isOnboarded) {
        // We don't need to do anything here, the component will render the manager.
        return;
    }

    // If we get here, the user is logged in AND onboarded.
    // Let's redirect them to their correct role-based dashboard if they land on a generic page.
    if (isOnboarded && appUser?.role) {
      const intendedPath = ROLE_REDIRECTS[appUser.role];
      const currentBasePath = `/${pathname.split('/')[1]}`;
      
      // If user is on a generic page like '/' or on a page not meant for their role, redirect them.
      if (pathname === '/' || pathname === '/login' || currentBasePath !== intendedPath) {
        router.replace(intendedPath);
      }
    }

  }, [isInitialAuthLoading, user, isOnboarded, appUser, devMode, router, pathname]);

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

  // If user is logged in but not onboarded, render the OnboardingFlowManager.
  // This manager will handle redirecting to the correct /onboarding/... page.
  if (user && !isOnboarded) {
    return <OnboardingFlowManager />;
  }

  // If user is fully onboarded, show the main application content.
  if (isOnboarded) {
    return <>{children}</>;
  }

  // Fallback, should not be reached in normal flow.
  return null;
}

function OnboardingFlowManager() {
    const { user, devMode } = useAuthContext();
    const firestore = useFirestore();
    const router = useRouter();
    const { setStaffToVerify, setStaffListToResolve } = useOnboardingStore();

  useEffect(() => {
    if (devMode) {
      // Dev mode bypasses onboarding logic.
      // A simple reload might be too aggressive if context isn't ready.
      // Let's try redirecting to /admin, which is the dev default.
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

      // Does this user's email match an existing staff record?
      if (user.email) {
        const staffQ = query(
          collection(firestore, "staff"),
          where("email", "==", user.email),
          where("employmentStatus", "==", "Active")
        );
        const staffSnap = await getDocs(staffQ);
        const staffList = staffSnap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Staff) })
        );

                if (staffList.length === 1) {
                    setStaffToVerify(staffList[0]);
                    router.replace('/onboarding/verify');
                } else if (staffList.length > 1) {
                    setStaffListToResolve(staffList);
                    router.replace('/onboarding/resolve');
                } else {
                    router.replace("/onboarding/apply");
                }
            } else {
                 router.replace("/onboarding/apply");
            }
        };

        checkStatusAndRedirect();

    }, [user, firestore, devMode, router, setStaffToVerify, setStaffListToResolve]);
    
    // Render a loading state while the check is in progress
    return (
         <div className="flex h-svh w-full items-center justify-center">
            <p className="text-center text-muted-foreground">Redirecting to onboarding...</p>
         </div>
    );
}
