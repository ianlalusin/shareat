
"use client";

import { ReactNode, useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useFirestore } from "@/firebase";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { ExistingStaffVerification } from "./onboarding/existing-staff-verification";
import { DuplicateStaffResolution } from "./onboarding/duplicate-staff-resolution";
import { AccountApplicationScreen } from "./onboarding/account-application";
import { PendingApprovalScreen } from "./onboarding/pending-approval";
import type { Staff } from "@/lib/types";
import { useAuthContext } from "@/context/auth-context";

type OnboardingState =
  | { status: "loading" }
  | { status: "ready" } // fully onboarded
  | { status: "existingStaff"; staff: Staff & { id: string} } // exactly one match
  | { status: "duplicateStaff"; staffList: (Staff & { id: string})[] } // multiple matches
  | { status: "applicant"; pendingId?: string } // no staff, application needed
  | { status: "pendingApproval" }; // already applied, waiting for admin

export function FirstLoginGuard({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, devMode } = useAuthContext();
  const firestore = useFirestore();
  const router = useRouter();

  const [state, setState] = useState<OnboardingState>({ status: "loading" });

  useEffect(() => {
    if (authLoading || !firestore) return;

    if (devMode) {
      setState({ status: "ready" });
      return;
    }

    if (!user) {
      router.push("/login");
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const userRef = doc(firestore, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          if (cancelled) return;
          
          await updateDoc(userRef, { lastLoginAt: serverTimestamp() });

          setState({ status: "ready" });
          return;
        }

        if (user.email) {
          const pendingQ = query(
            collection(firestore, "pendingAccounts"),
            where("uid", "==", user.uid),
            where("status", "==", "pending")
          );
          const pendingSnap = await getDocs(pendingQ);

          if (!pendingSnap.empty) {
            if (cancelled) return;
            setState({ status: "pendingApproval" });
            return;
          }
        }

        if (!user.email) {
          if (cancelled) return;
          setState({ status: "applicant" });
          return;
        }

        const staffQ = query(
          collection(firestore, "staff"),
          where("email", "==", user.email),
          where("employmentStatus", "==", "Active")
        );

        const staffSnap = await getDocs(staffQ);
        const staffList = staffSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Staff),
        }));

        if (cancelled) return;

        if (staffList.length === 1) {
          setState({ status: "existingStaff", staff: staffList[0] });
        } else if (staffList.length > 1) {
          setState({ status: "duplicateStaff", staffList });
        } else {
          setState({ status: "applicant" });
        }
      } catch (err) {
        console.error("FirstLoginGuard error", err);
        setState({ status: "ready" });
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [authLoading, firestore, user, router, devMode]);

  // ----- Render scenarios -----

  if (state.status === "loading" || authLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/40 text-sm text-muted-foreground">
        Checking your account…
      </div>
    );
  }

  if (state.status === "existingStaff" && user && firestore) {
    return (
      <ExistingStaffVerification
        staff={state.staff}
        firebaseUser={user}
        firestore={firestore}
        onComplete={() => setState({ status: "ready" })}
      />
    );
  }

  if (state.status === "duplicateStaff" && user && firestore) {
    return (
      <DuplicateStaffResolution
        staffList={state.staffList}
        firebaseUser={user}
        firestore={firestore}
        onComplete={() => setState({ status: "ready" })}
      />
    );
  }

  if (state.status === "applicant" && user && firestore) {
    return (
      <AccountApplicationScreen
        firebaseUser={user}
        firestore={firestore}
        onSubmitted={() => setState({ status: "pendingApproval" })}
      />
    );
  }

  if (state.status === "pendingApproval") {
    return <PendingApprovalScreen />;
  }

  // Fully onboarded or in dev mode
  return <>{children}</>;
}
