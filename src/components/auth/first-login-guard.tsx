
"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFirestore } from "@/firebase";
import {
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { ExistingStaffVerification } from "./onboarding/existing-staff-verification";
import { DuplicateStaffResolution } from "./onboarding/duplicate-staff-resolution";
import { AccountApplicationScreen } from "./onboarding/account-application";
import { PendingApprovalScreen } from "./onboarding/pending-approval";
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
  const { user, loading, isOnboarded, devMode } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && !devMode) {
      router.push("/login");
    }
  }, [loading, user, devMode, router]);
  
  if (loading) {
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

  if (isOnboarded) {
    return <>{children}</>;
  }

  // If not onboarded and not loading, determine which onboarding screen to show.
  // This part now requires a separate component or a more complex state within the guard
  // to avoid re-running the checks constantly. For now, we will redirect to a generic
  // onboarding start page if one existed, or directly to the application. A full implementation
  // requires a more sophisticated state machine now that the primary check is in the context.
  // For this fix, we assume if you're not onboarded, you need to apply.
  if (user && firestore) {
     // A simplified check for the purpose of showing the correct initial screen
     // This could be further optimized into its own state machine if onboarding becomes more complex
    return <OnboardingFlowManager />;
  }

  // Fallback for when user is null but somehow we got here
  return null;
}


function OnboardingFlowManager() {
    const { user, devMode } = useAuthContext();
    const firestore = useFirestore();
    const [status, setStatus] = useState<OnboardingStatus>("loading");
    const [staffData, setStaffData] = useState<any>(null);

    useEffect(() => {
        if (devMode) {
            setStatus("ready");
            return;
        }
        if (!user || !firestore) return;

        const checkStatus = async () => {
            // Has this user already applied and is pending?
            const pendingQ = query(collection(firestore, "pendingAccounts"), where("uid", "==", user.uid), where("status", "==", "pending"));
            const pendingSnap = await getDocs(pendingQ);
            if (!pendingSnap.empty) {
                setStatus("pendingApproval");
                return;
            }

            // Does this user's email match an existing staff record?
            if(user.email){
                const staffQ = query(collection(firestore, "staff"), where("email", "==", user.email), where("employmentStatus", "==", "Active"));
                const staffSnap = await getDocs(staffQ);
                const staffList = staffSnap.docs.map(d => ({ id: d.id, ...(d.data() as Staff) }));

                if (staffList.length === 1) {
                    setStaffData(staffList[0]);
                    setStatus("existingStaff");
                } else if (staffList.length > 1) {
                    setStaffData(staffList);
                    setStatus("duplicateStaff");
                } else {
                    setStatus("applicant");
                }
            } else {
                 setStatus("applicant");
            }
        };

        checkStatus();

    }, [user, firestore, devMode]);
    
    if (status === "loading") {
        return (
             <div className="flex h-svh w-full items-center justify-center">
                <p className="text-center text-muted-foreground">Determining next step...</p>
             </div>
        );
    }
    
    if (status === "existingStaff" && user && firestore) {
        return <ExistingStaffVerification staff={staffData} firebaseUser={user} firestore={firestore} onComplete={() => window.location.reload()} />;
    }

    if (status === "duplicateStaff" && user && firestore) {
        return <DuplicateStaffResolution staffList={staffData} firebaseUser={user} firestore={firestore} onComplete={() => window.location.reload()} />;
    }

    if (status === "applicant" && user && firestore) {
        return <AccountApplicationScreen firebaseUser={user} firestore={firestore} onSubmitted={() => setStatus("pendingApproval")} />;
    }

    if (status === "pendingApproval") {
        return <PendingApprovalScreen />;
    }

    // Should not be reached
    return null;
}
