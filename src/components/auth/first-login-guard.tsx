
"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFirestore } from "@/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import type { Staff } from "@/lib/types";
import { useAuthContext } from "@/context/auth-context";
import { Skeleton } from "../ui/skeleton";

type OnboardingStatus =
  | "loading"
  | "ready" // Fully onboarded
  | "existingStaff" // Found one matching staff record
  | "duplicateStaff" // Found multiple matching staff records
  | "applicant" // No staff record, application needed
  | "pendingApproval"; // Applied, waiting for admin

export function FirstLoginGuard({ children }: { children: ReactNode }) {
  const { user, isInitialAuthLoading, isOnboarded, devMode } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!isInitialAuthLoading && !user && !devMode) {
      router.push("/login");
    }
  }, [isInitialAuthLoading, user, devMode, router]);
  
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

  // If user is fully onboarded, show the main application content.
  if (isOnboarded) {
    return <>{children}</>;
  }

  // If we are still here, the user is logged in but not onboarded.
  // The OnboardingFlowManager will figure out where to send them.
  if (user) {
    return <OnboardingFlowManager />;
  }

  // Fallback, should not be reached in normal flow.
  return null;
}


function OnboardingFlowManager() {
    const { user, devMode } = useAuthContext();
    const firestore = useFirestore();
    const router = useRouter();

    useEffect(() => {
        if (devMode) {
            // Dev mode bypasses onboarding logic, reload to get into main app.
             window.location.reload();
            return;
        }
        if (!user || !firestore) return;

        const checkStatusAndRedirect = async () => {
            // Has this user already applied and is pending?
            const pendingQ = query(collection(firestore, "pendingAccounts"), where("uid", "==", user.uid), where("status", "==", "pending"));
            const pendingSnap = await getDocs(pendingQ);
            if (!pendingSnap.empty) {
                router.replace("/onboarding/pending");
                return;
            }

            // Does this user's email match an existing staff record?
            if(user.email){
                const staffQ = query(collection(firestore, "staff"), where("email", "==", user.email), where("employmentStatus", "==", "Active"));
                const staffSnap = await getDocs(staffQ);
                const staffList = staffSnap.docs.map(d => ({ id: d.id, ...(d.data() as Staff) }));

                if (staffList.length === 1) {
                    // Pass staff data via state to the verification page
                    // Note: This is a simple approach. For complex data, consider a state manager.
                    router.replace('/onboarding/verify', { state: { staffData: staffList[0] } } as any);
                } else if (staffList.length > 1) {
                    router.replace('/onboarding/resolve', { state: { staffList } } as any);
                } else {
                    router.replace("/onboarding/apply");
                }
            } else {
                 router.replace("/onboarding/apply");
            }
        };

        checkStatusAndRedirect();

    }, [user, firestore, devMode, router]);
    
    // Render a loading state while the check is in progress
    return (
         <div className="flex h-svh w-full items-center justify-center">
            <p className="text-center text-muted-foreground">Redirecting to onboarding...</p>
         </div>
    );
}
