
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

    // wait until profile loaded
    if (!appUser) return;

    // only active users can access protected pages
    if (appUser.status !== "active") {
      router.replace("/pending");
      return;
    }

    const userRoles = Array.isArray(appUser.roles) && appUser.roles.length > 0
      ? appUser.roles
      : appUser.role
        ? [appUser.role]
        : [];

    const ok = allow.some((r) => userRoles.includes(r));

    if (!ok) {
      // send them to their home instead of leaving them stuck
      const home = roleHome(appUser.role);
      if (pathname !== home) router.replace(home);
    }
  }, [allow, appUser, loading, pathname, router, user]);

  const canRender =
    !!user &&
    !!appUser &&
    appUser.status === "active" &&
    (() => {
      const userRoles =
        Array.isArray(appUser.roles) && appUser.roles.length > 0
          ? appUser.roles
          : appUser.role
            ? [appUser.role]
            : [];
      return allow.some((r) => userRoles.includes(r));
    })();

  if (loading) return null;
  if (!canRender) return null; 

  return <>{children}</>;
}
