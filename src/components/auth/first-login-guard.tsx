
"use client";

import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFirestore } from "@/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import type { Staff } from "@/lib/types";
import { useAuthContext } from "@/context/auth-context";
import { Skeleton } from "../ui/skeleton";
import { useOnboardingStore } from "@/store/use-onboarding-store";

export function FirstLoginGuard({ children }: { children: ReactNode }) {
  const { user, isInitialAuthLoading, isOnboarded, devMode } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isInitialAuthLoading) {
      return; // Wait until auth state is fully determined
    }

    if (!user && !devMode) {
      // If not logged in, ensure user is on a public page or redirect to login.
      const isPublicPath = pathname.startsWith('/login') || pathname.startsWith('/onboarding');
      if (!isPublicPath) {
        router.replace("/login");
      }
      return;
    }

    if (isOnboarded) {
      // User is fully onboarded. If they land on a public page, redirect them.
      const isOnPublicAuthPage = pathname === '/login' || pathname.startsWith('/onboarding') || pathname === '/';
      if (isOnPublicAuthPage) {
        router.replace('/admin'); // Default page for all onboarded users
      }
    }
    // If user is logged in but !isOnboarded, the component will render OnboardingFlowManager
    // which handles the specific onboarding step redirects.
    
  }, [isInitialAuthLoading, user, isOnboarded, devMode, router, pathname]);

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

  if (user && !isOnboarded) {
    return <OnboardingFlowManager />;
  }

  if (isOnboarded) {
    return <>{children}</>;
  }
  
  if (!user && (pathname.startsWith('/login') || pathname.startsWith('/onboarding'))) {
    return <>{children}</>;
  }

  // Fallback, should ideally not be reached if logic is sound.
  return null;
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
    
    return (
         <div className="flex h-svh w-full items-center justify-center">
            <p className="text-center text-muted-foreground">Redirecting to onboarding...</p>
         </div>
    );
}
