import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * CORS for /api.
 *
 * The offline APK loads the static client from a local Capacitor origin
 * (https://localhost) and calls the deployed backend (app.shareat.net)
 * cross-origin, so authenticated /api requests trigger a CORS preflight the
 * route handlers don't answer — issue/reissue/repair, join-url, loyalty, etc.
 * all fail. The web app is same-origin and unaffected (no CORS headers added
 * for its own origin).
 *
 * NOTE: middleware is incompatible with `output: export`, so the Capacitor build
 * (scripts/build-capacitor.mjs) stashes this file before exporting. It only runs
 * on the App Hosting (SSR) deployment, which is exactly where /api lives.
 */
const ALLOWED_ORIGINS = new Set([
  "https://localhost", // Capacitor Android (androidScheme: 'https')
  "capacitor://localhost", // Capacitor iOS (future)
  "http://localhost", // local dev / cleartext fallback
]);

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    // x-pos-operator-session: signed local-user token on the financial commands; a header
    // missing from this list fails the preflight and the APK just reports "Failed to fetch".
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-pos-operator-session",
    "Access-Control-Max-Age": "86400",
  };
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : null;

  // Preflight — answer it so the cross-origin POST (with Authorization) proceeds.
  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(allowed ?? "https://localhost"),
    });
  }

  const res = NextResponse.next();
  if (allowed) {
    res.headers.set("Access-Control-Allow-Origin", allowed);
    res.headers.set("Vary", "Origin");
  }
  return res;
}

export const config = { matcher: ["/api/:path*"] };
