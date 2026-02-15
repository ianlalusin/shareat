"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthContext } from "@/context/auth-context";

type Props = {
  allow: Array<"admin" | "manager" | "cashier" | "kitchen" | "server">;
  children: React.ReactNode;
};

function roleHome(role?: string) {
  switch (role) {
    case "admin":
      return "/dashboard";
    case "manager":
      return "/dashboard";
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

export function RoleGuard({ allow, children }: Props) {
  const { user, appUser, loading } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace("/");
      return;
    }

    if (!appUser) return;

    if (appUser.status !== "active") {
      router.replace("/pending");
      return;
    }

    // New RBAC check
    const isAllowed = allow.some(requiredRole => {
        // Platform Admins can access everything.
        if (appUser.isPlatformAdmin) return true;

        // For non-admins, check their role from the staff doc.
        if (requiredRole === appUser.role) return true;
        
        // The 'admin' role in the UI now specifically requires the platformAdmin claim.
        // If a page requires 'admin' and the user is not a platformAdmin, deny access.
        if (requiredRole === 'admin' && !appUser.isPlatformAdmin) return false;

        return false;
    });

    if (!isAllowed) {
      const home = roleHome(appUser.role);
      if (pathname !== home) router.replace(home);
    }
  }, [allow, appUser, loading, pathname, router, user]);

  // Determine if children can be rendered
  const canRender =
    !!user &&
    !!appUser &&
    appUser.status === "active" &&
    allow.some(requiredRole => {
      if (requiredRole === 'admin') return appUser.isPlatformAdmin === true;
      if (appUser.isPlatformAdmin) return true; // Platform admins can access non-admin pages too.
      return appUser.role === requiredRole;
    });

  if (loading || !canRender) {
    return null; // Or a loading spinner
  }

  return <>{children}</>;
}
