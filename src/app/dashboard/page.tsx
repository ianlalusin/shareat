"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/context/auth-context";
import { BrandLoader } from "@/components/ui/BrandLoader";

function roleHome(role?: string) {
  switch (role) {
    case "admin":
    case "manager":
      return "/admin";
    case "cashier":
      return "/cashier";
    case "kitchen":
      return "/kitchen";
    case "server":
      return "/server";
    default:
      // A safe fallback, though FirstLoginGuard should handle most cases.
      return "/"; 
  }
}

export default function DashboardRedirectPage() {
    const { appUser, loading } = useAuthContext();
    const router = useRouter();

    useEffect(() => {
        if (loading) {
            return;
        }

        if (appUser) {
            const homeRoute = roleHome(appUser.role);
            router.replace(homeRoute);
        } else {
            // If there's no user for some reason, redirect to login.
            router.replace('/');
        }
    }, [appUser, loading, router]);

    return (
        <div className="flex items-center justify-center h-full">
            <BrandLoader />
        </div>
    );
}
