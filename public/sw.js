const CACHE_NAME = 'shareat-pos-v2'; // bump version to force update

// Update this list when you add key routes/assets
const URLS_TO_PRECACHE = [
  '/',
  '/login',
  '/cashier',
  '/refill',
  '/kitchen',
  '/admin',
  '/admin/settings',
  '/favicon.ico',
  '/manifest.json'
];

// Install: cache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache');
      return cache.addAll(URLS_TO_PRECACHE).catch(err => {
        console.error('Failed to cache all:', err);
        // Even if one fails, we want the SW to install.
        // You might want more robust error handling here.
      });
    })
  );
  self.skipWaiting();
});

// Activate: cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for navigation and static resources
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // For navigations and same-origin assets, use cache-first
  if (
    request.mode === 'navigate' ||
    (request.destination === 'style' ||
      request.destination === 'script' ||
      request.destination === 'image')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          // Do not cache error responses
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
  }
});
