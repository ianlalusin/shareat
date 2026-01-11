// Basic service worker for PWA capabilities

self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  // No caching logic for this basic setup
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
});

self.addEventListener('fetch', (event) => {
  // This basic service worker doesn't intercept fetch requests.
  // It's here to make the app installable.
  // More advanced caching strategies can be added later.
});
