import type { NextConfig } from "next";

const isCI = process.env.CI === "true";
const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  typescript: {
    // ✅ fail builds in prod/CI
    ignoreBuildErrors: !(isCI || isProd),
  },
  eslint: {
    // ✅ fail builds in prod/CI
    ignoreDuringBuilds: !(isCI || isProd),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "placehold.co", pathname: "/**" },
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
      { protocol: "https", hostname: "picsum.photos", pathname: "/**" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com", pathname: "/**" },
    ],
  },
};

export default nextConfig;
