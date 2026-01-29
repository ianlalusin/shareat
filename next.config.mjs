/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disables trailing slashes (e.g., /about/ -> /about) to prevent redirects
  // that can interfere with service worker registration.
  trailingSlash: false,

  // Explicitly sets headers for the service worker file to ensure it's served
  // with the correct content type and not cached improperly.
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          }
        ],
      },
    ]
  },
};

export default nextConfig;
