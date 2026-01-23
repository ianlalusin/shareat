
"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthContext } from "@/context/auth-context";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { AppLayout } from "@/components/layout/AppLayout";

function roleHome(role?: string) {
  switch (role) {
    case "admin":
      return "/admin";
    case "manager":
      return "/admin";
    case "cashier":
      return "/cashier";
    case "kitchen":
      return "/kitchen";
    case "server":
      return "/server";
    default:
      return "/dashboard";
  }
}

const PUBLIC = ["/login", "/signup", "/forgot-password", "/support"];
const PENDING_ALLOWED = ["/pending", "/support"];
const NEEDS_PROFILE_ALLOWED = ["/signup", "/support"];

export function FirstLoginGuard({ children }: { children: React.ReactNode }) {
  const { user, appUser, loading, isSigningOut } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    // Safety reset for Radix UI dialogs/popovers on navigation
    document.body.style.pointerEvents = "auto";
    document.documentElement.style.pointerEvents = "auto";

    // --- REDIRECTION LOGIC ---
    if (loading || isSigningOut) return; // Wait until auth state is resolved and not signing out

    // Case 1: No user logged in
    if (!user) {
      if (!PUBLIC.includes(pathname) && pathname !== '/') {
        router.replace("/login");
      }
      return;
    }

    // From here, `user` is guaranteed to exist.
    if (!appUser) return; // Wait for appUser profile

    // Case 3: User needs to create their profile
    if (appUser.status === "needs_profile") {
      if (!NEEDS_PROFILE_ALLOWED.includes(pathname)) {
        router.replace("/signup");
      }
      return;
    }
    
    // Case 4: User is pending approval or disabled
    if (appUser.status !== "active") {
      if (!PENDING_ALLOWED.includes(pathname)) {
        router.replace("/pending");
      }
      return;
    }
    
    // Case 5: User is active and on a page they shouldn't be on
    if (PUBLIC.includes(pathname) || PENDING_ALLOWED.includes(pathname) || NEEDS_PROFILE_ALLOWED.includes(pathname) || pathname === '/') {
        router.replace(roleHome(appUser.role));
    }
  }, [loading, user, appUser, pathname, router, isSigningOut]);


  // --- RENDER LOGIC ---

  if (loading || (!user && !PUBLIC.includes(pathname) && pathname !== '/')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
      </div>
    );
  }

  // Unauthenticated user on a public page
  if (!user) {
    return <>{children}</>;
  }
  
  // Authenticated user, but profile is still loading (or doesn't exist)
  if (!appUser) {
     return (
       <div className="min-h-screen flex items-center justify-center bg-background">
         <BrandLoader />
       </div>
     );
  }

  // Authenticated user on a page appropriate for their status
  if (appUser.status === 'needs_profile') {
      if (NEEDS_PROFILE_ALLOWED.includes(pathname)) return <>{children}</>;
  }
  if (appUser.status !== 'active') {
      if (PENDING_ALLOWED.includes(pathname)) return <>{children}</>;
  }
  if (appUser.status === 'active') {
      // If it's a protected page, render it
      if (!PUBLIC.includes(pathname) && !PENDING_ALLOWED.includes(pathname) && !NEEDS_PROFILE_ALLOWED.includes(pathname) && pathname !== '/') {
        return <AppLayout>{children}</AppLayout>;
      }
  }

  // For any other case (e.g., redirecting), show a loader.
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <BrandLoader />
    </div>
  );
}
