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
    if (loading || isSigningOut) return;

    // Not logged in: if not on a public page, redirect to login.
    if (!user) {
      if (!PUBLIC.includes(pathname) && pathname !== '/') {
        router.replace("/login");
      }
      return;
    }

    // Logged in, but app user profile is still loading.
    if (!appUser) return;

    // Handle different user statuses
    if (appUser.status === "needs_profile") {
      if (!NEEDS_PROFILE_ALLOWED.includes(pathname)) {
        router.replace("/signup");
      }
      return;
    }
    
    if (appUser.status !== "active") {
      if (!PENDING_ALLOWED.includes(pathname)) {
        router.replace("/pending");
      }
      return;
    }
    
    // Active user: if on a public/pending page, redirect to their home.
    if (PUBLIC.includes(pathname) || PENDING_ALLOWED.includes(pathname) || NEEDS_PROFILE_ALLOWED.includes(pathname) || pathname === '/') {
        router.replace(roleHome(appUser.role));
    }
  }, [loading, user, appUser, pathname, router, isSigningOut]);

  // --- RENDER LOGIC ---

  if (loading) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <BrandLoader />
        </div>
    );
  }

  // Allow public pages to render for unauthenticated users
  if (!user && (PUBLIC.includes(pathname) || pathname === '/')) {
    return <>{children}</>;
  }

  // If user is authenticated, check their status and decide what to render
  if (user && appUser) {
    if (appUser.status === 'needs_profile') {
      return NEEDS_PROFILE_ALLOWED.includes(pathname) ? <>{children}</> : <BrandLoader />;
    }
    if (appUser.status !== 'active') {
      return PENDING_ALLOWED.includes(pathname) ? <>{children}</> : <BrandLoader />;
    }
    // Active user on a protected page
    if (appUser.status === 'active' && !PUBLIC.includes(pathname) && !PENDING_ALLOWED.includes(pathname) && !NEEDS_PROFILE_ALLOWED.includes(pathname) && pathname !== '/') {
        return <AppLayout>{children}</AppLayout>;
    }
  }

  // Fallback for all other cases (e.g., redirecting, initial load before useEffect)
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
    </div>
  );
}
