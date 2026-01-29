// This is a minimal service worker file.
// It immediately activates upon installation and takes control of the page.
// The 'fetch' event listener is a no-op, meaning it doesn't intercept
// any network requests. This is a safe starting point for a PWA.

self.addEventListener('install', (event) => {
  self.skipWaiting();
  console.log('Service worker installing...');
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  console.log('Service worker activating...');
});

self.addEventListener('fetch', (event) => {
  // No-op. The browser will handle the request as if the service worker wasn't here.
  return;
});
