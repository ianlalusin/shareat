
"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFirestore } from "@/firebase";
import { collection, query, where, getDocs, doc, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import type { Staff, User as AppUser } from "@/lib/types";
import { useAuthContext, isStaffActive } from "@/context/auth-context";
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

    if (!user && !devMode) {
      const isPublicPath = pathname.startsWith('/login') || pathname.startsWith('/onboarding');
      if (!isPublicPath) {
        router.replace("/login");
        setHasRedirected(true);
      }
      return;
    }

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

  if (user && !isOnboarded && !devMode) {
    const isOnboardingPath = pathname.startsWith('/onboarding');
    return isOnboardingPath ? children : <OnboardingFlowManager />;
  }

  if (isOnboarded) {
    return <>{children}</>;
  }
  
  if (!user && (pathname.startsWith('/login') || pathname.startsWith('/onboarding'))) {
    return <>{children}</>;
  }

  if (devMode) {
    return <>{children}</>;
  }

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
      // Safety check: if user has a linked staff record, force main app context to handle it.
      const staffByAuthUidQuery = query(collection(firestore, "staff"), where("authUid", "==", user.uid));
      const staffByAuthUidSnap = await getDocs(staffByAuthUidQuery);
      const linkedStaff = staffByAuthUidSnap.docs.map(d => ({ id: d.id, ...(d.data() as Staff) })).filter(isStaffActive);
      if (linkedStaff.length > 0) {
        // AuthContext should handle this, but as a failsafe, reload to trigger it.
        window.location.href = '/';
        return;
      }
      
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
      
      // Fallback to email for first-time linking
      if (user.email) {
        const staffByEmailQuery = query(collection(firestore, "staff"), where("email", "==", user.email));
        const staffSnap = await getDocs(staffByEmailQuery);
        
        const matchingStaff = staffSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Staff) }));
        const activeStaffList = matchingStaff.filter(s => isStaffActive(s));

        if (activeStaffList.length === 1) {
            // Check if this single active match is already linked to someone else.
            if (activeStaffList[0].authUid) {
               router.replace("/onboarding/apply"); // Go to new application if their email is on a taken profile
            } else {
               setStaffToVerify(activeStaffList[0]);
               router.replace('/onboarding/verify');
            }
        } else if (activeStaffList.length > 1) {
            const unlinkedActiveStaff = activeStaffList.filter(s => !s.authUid);
            if (unlinkedActiveStaff.length === 1) {
              setStaffToVerify(unlinkedActiveStaff[0]);
              router.replace('/onboarding/verify');
            } else if (unlinkedActiveStaff.length > 1) {
              setStaffListToResolve(unlinkedActiveStaff);
              router.replace('/onboarding/resolve');
            } else {
              router.replace("/onboarding/apply");
            }
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
