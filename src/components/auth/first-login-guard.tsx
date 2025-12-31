
"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthContext } from "@/context/auth-context";
import { BrandLoader } from "@/components/ui/BrandLoader";

function roleHome(role?: string) {
  switch (role) {
    case "admin":
      return "/admin";
    case "manager":
      return "/manager";
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

const PUBLIC = ["/", "/signup"];
const PENDING_ALLOWED = ["/pending", "/support"];
const NEEDS_PROFILE_ALLOWED = ["/signup", "/support"];

export function FirstLoginGuard({ children }: { children: React.ReactNode }) {
  const { user, appUser, loading } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Safety reset after actions that trigger dialogs + rerenders
    document.body.style.pointerEvents = "auto";
    document.documentElement.style.pointerEvents = "auto";
    document.body.style.removeProperty("pointer-events");
    document.documentElement.style.removeProperty("pointer-events");
  }, [pathname]);


  useEffect(() => {
    if (loading) return;

    const isPublic = PUBLIC.includes(pathname);

    // not logged in -> only allow public pages
    if (!user) {
      if (!isPublic) router.replace("/");
      return;
    }

    // logged in but profile not loaded yet -> DO NOTHING (prevents wrong redirects)
    if (!appUser) return;

    const status = appUser.status;

    // needs_profile -> allow only signup/support
    if (status === "needs_profile") {
      if (!NEEDS_PROFILE_ALLOWED.includes(pathname)) router.replace("/signup");
      return;
    }

    // pending/disabled -> allow only pending/support
    if (status && status !== "active") {
      if (!PENDING_ALLOWED.includes(pathname)) router.replace("/pending");
      return;
    }

    // active -> if trying to access public/pending pages, route to role home
    if (isPublic || pathname === "/pending") {
      router.replace(roleHome(appUser.role));
      return;
    }

    // otherwise allow page
  }, [user, appUser, loading, pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
      </div>
    );
  }

  // Show loader if user is authenticated but their app profile is still loading.
  // This prevents the login page from flashing for an already logged-in user.
  if (user && !appUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
      </div>
    );
  }

  // Synchronously determine if a redirect will occur. If so, render the loader
  // to prevent the current page from flashing while the useEffect hook triggers.
  let redirectTo: string | null = null;
  const isPublic = PUBLIC.includes(pathname);

  if (!user) {
    if (!isPublic) {
      redirectTo = "/";
    }
  } else if (appUser) {
    const status = appUser.status;
    if (status === "needs_profile") {
      if (!NEEDS_PROFILE_ALLOWED.includes(pathname)) {
        redirectTo = "/signup";
      }
    } else if (status && status !== "active") {
      if (!PENDING_ALLOWED.includes(pathname)) {
        redirectTo = "/pending";
      }
    } else { // active user
      if (isPublic || pathname === "/pending") {
        redirectTo = roleHome(appUser.role);
      }
    }
  }

  if (redirectTo && redirectTo !== pathname) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
      </div>
    );
  }
  
  return <>{children}</>;
}
