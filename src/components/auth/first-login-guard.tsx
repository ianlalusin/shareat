
"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthContext } from "@/context/auth-context";

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

  if (loading) return null;
  return <>{children}</>;
}
