
"use client";

import { useEffect, useState } from "react";
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

const PUBLIC = ["/", "/signup", "/forgot-password", "/support"];
const PENDING_ALLOWED = ["/pending", "/support"];
const NEEDS_PROFILE_ALLOWED = ["/signup", "/support"];

export function FirstLoginGuard({ children }: { children: React.ReactNode }) {
  const { user, appUser, loading } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    // Safety reset for Radix UI dialogs/popovers on navigation
    document.body.style.pointerEvents = "auto";
    document.documentElement.style.pointerEvents = "auto";
  }, [pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
      </div>
    );
  }

  // Case 1: No user logged in
  if (!user) {
    if (PUBLIC.includes(pathname)) {
      return <>{children}</>; // Allow access to public pages
    }
    // Not a public page, redirect to login
    router.replace("/");
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
      </div>
    );
  }

  // From here, `user` is guaranteed to exist. Now check `appUser` status.
  
  // Case 2: User exists, but appUser profile is still loading (should be covered by main `loading` but as a safeguard)
  if (!appUser) {
     return (
       <div className="min-h-screen flex items-center justify-center bg-background">
         <BrandLoader />
       </div>
     );
  }

  // Case 3: User needs to create their profile
  if (appUser.status === "needs_profile") {
    if (NEEDS_PROFILE_ALLOWED.includes(pathname)) {
      return <>{children}</>;
    }
    router.replace("/signup");
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
      </div>
    );
  }
  
  // Case 4: User is pending approval or disabled
  if (appUser.status !== "active") {
    if (PENDING_ALLOWED.includes(pathname)) {
      return <>{children}</>;
    }
    router.replace("/pending");
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
      </div>
    );
  }
  
  // Case 5: User is active and authenticated.
  // If they are trying to access a public/pending page, redirect them to their home page.
  if (PUBLIC.includes(pathname) || PENDING_ALLOWED.includes(pathname) || NEEDS_PROFILE_ALLOWED.includes(pathname)) {
      router.replace(roleHome(appUser.role));
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <BrandLoader />
        </div>
      );
  }

  // If we get here, user is active and on a protected page. Render it inside the main app layout.
  return <AppLayout>{children}</AppLayout>;
}
