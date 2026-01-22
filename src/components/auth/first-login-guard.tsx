
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Button } from "@/components/ui/button";

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

const StuckComponent = () => (
  <div className="flex flex-col items-center gap-4 text-center">
    <p className="text-muted-foreground">Having trouble loading the page.</p>
    <div className="flex gap-2">
      <Button onClick={() => window.location.reload()}>Reload</Button>
      <Button variant="outline" onClick={() => (window.location.href = "/")}>Go to Login</Button>
    </div>
  </div>
);

export function FirstLoginGuard({ children }: { children: React.ReactNode }) {
  const { user, appUser, loading: authLoading } = useAuthContext();
  const { activeStoreId, loading: storeLoading } = useStoreContext();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const loading = authLoading || storeLoading;
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    // Safety reset for Radix UI dialogs/popovers on navigation
    document.body.style.pointerEvents = "auto";
    document.documentElement.style.pointerEvents = "auto";
  }, [pathname]);
  
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (loading) {
      timer = setTimeout(() => setStuck(true), 8000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        {stuck ? <StuckComponent /> : <BrandLoader />}
      </div>
    );
  }

  // Case 1: No user logged in
  if (!user) {
    if (PUBLIC.includes(pathname)) {
      return <>{children}</>; // Allow access to public pages
    } else {
      router.replace("/"); // Redirect other routes to login
      return <div className="min-h-screen flex items-center justify-center bg-background"><BrandLoader /></div>;
    }
  }

  // Case 2: User logged in, but appUser profile is still loading
  if (!appUser) {
     return <div className="min-h-screen flex items-center justify-center bg-background"><BrandLoader /></div>;
  }
  
  // Case 3: User needs to create their profile
  if (appUser.status === "needs_profile") {
    if (NEEDS_PROFILE_ALLOWED.includes(pathname)) {
      return <>{children}</>;
    } else {
      router.replace("/signup");
      return <div className="min-h-screen flex items-center justify-center bg-background"><BrandLoader /></div>;
    }
  }
  
  // Case 4: User is pending approval or disabled
  if (appUser.status !== "active") {
    if (PENDING_ALLOWED.includes(pathname)) {
      return <>{children}</>;
    } else {
      router.replace("/pending");
      return <div className="min-h-screen flex items-center justify-center bg-background"><BrandLoader /></div>;
    }
  }
  
  // Case 5: User is active and authenticated
  if (PUBLIC.includes(pathname) || PENDING_ALLOWED.includes(pathname) || NEEDS_PROFILE_ALLOWED.includes(pathname)) {
      router.replace(roleHome(appUser.role));
      return <div className="min-h-screen flex items-center justify-center bg-background"><BrandLoader /></div>;
  }

  // If we get here, user is authenticated, active, and on a protected page.
  return <>{children}</>;
}
