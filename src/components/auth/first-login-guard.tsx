
"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthContext } from "@/context/auth-context";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

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
  const { user, appUser, loading, isSigningOut, staffError, signOut } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    // Don't perform any redirects while loading or signing out.
    if (loading || isSigningOut) return;

    // If the user isn't authenticated, redirect them to login unless they are on a public page.
    if (!user) {
      if (!PUBLIC.includes(pathname) && pathname !== '/') {
        router.replace("/login");
      }
      return;
    }
    
    // If there's an error loading the staff profile, don't redirect. The render logic will show an error screen.
    if (staffError) return;

    // If we have the appUser, we can proceed with status-based routing.
    if (appUser) {
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
        
        // If an active user is on a public/limbo page, redirect them to their designated home.
        if (appUser.status === 'active' && (PUBLIC.includes(pathname) || PENDING_ALLOWED.includes(pathname) || NEEDS_PROFILE_ALLOWED.includes(pathname) || pathname === '/')) {
            router.replace(roleHome(appUser.role));
        }
    }
  }, [loading, user, appUser, staffError, pathname, router, isSigningOut]);

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

  // If user is logged in, but staff doc failed to load, show a specific error screen.
  if (user && !appUser && staffError) {
    const errorMsg = staffError.message.toLowerCase();
    const isAdblock = errorMsg.includes("firestore.googleapis.com") || errorMsg.includes("blocked by client");
    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Alert variant="destructive" className="max-w-lg">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error Loading Profile</AlertTitle>
                <AlertDescription>
                    We couldn't load your staff profile from the database. This can happen due to network issues or browser extensions.
                    {isAdblock && <p className="mt-2 font-semibold">It looks like a browser extension (like an ad-blocker) is blocking requests. Please try disabling it for this site and retry.</p>}
                    <p className="mt-2 text-xs opacity-70">Error: {staffError.message}</p>
                </AlertDescription>
                <div className="mt-4 flex gap-2">
                    <Button onClick={() => window.location.reload()}>Retry</Button>
                    <Button variant="secondary" onClick={signOut}>Sign Out</Button>
                </div>
            </Alert>
        </div>
    );
  }

  // If user is authenticated and we have their profile, check status and render layout or status pages.
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

  // Fallback for all other transient states (e.g., redirecting, initial load before useEffect)
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader />
    </div>
  );
}
