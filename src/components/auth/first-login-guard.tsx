
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

  // User is not logged in
  if (!user) {
    if (PUBLIC.includes(pathname)) {
      return <>{children}</>;
    }
    router.replace("/");
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
      </div>
    );
  }

  // User is logged in, but we are waiting for the appUser profile from Firestore
  if (!appUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
         {stuck ? <StuckComponent /> : <BrandLoader />}
      </div>
    );
  }

  // User needs to complete their profile
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

  // User is pending or disabled
  if (appUser.status && appUser.status !== "active") {
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
  
  // User is active and fully authenticated
  if (PUBLIC.includes(pathname) || PENDING_ALLOWED.includes(pathname)) {
    router.replace(roleHome(appUser.role));
     return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
      </div>
    );
  }

  // If none of the above conditions met, render the requested page
  return <>{children}</>;
}
