import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Capacitor APK build: static export of the client, bundled & loaded locally
// (offline-capable). The normal build (App Hosting) stays SSR with API routes.
const cap = process.env.BUILD_TARGET === "capacitor";

/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: cap ? true : false,
  turbopack: {
    root: __dirname,
  },
  images: cap
    ? { unoptimized: true } // no server image optimizer in a static export
    : {
        remotePatterns: [
          {
            protocol: "https",
            hostname: "firebasestorage.googleapis.com",
            pathname: "/v0/b/**",
          },
        ],
      },
  // Static export — produces ./out for Capacitor to bundle.
  ...(cap ? { output: "export" } : {}),
  // headers() needs a server; skip it for the static export.
  ...(cap
    ? {}
    : {
        async headers() {
          return [
            {
              // Staff app: keep every page, font and file out of Google (audit, Nov 2026).
              source: "/:path*",
              headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
            },
            {
              source: "/sw.js",
              headers: [
                { key: "Content-Type", value: "application/javascript; charset=utf-8" },
                { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
                { key: "Service-Worker-Allowed", value: "/" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
