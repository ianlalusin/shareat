"use client";

import { useEffect } from 'react';

const PwaInstaller = () => {
  useEffect(() => {
    // Only register the service worker in production environments
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      const registerServiceWorker = async () => {
        try {
          // Preflight check to ensure /sw.js is not redirected.
          // This helps prevent the "script resource is behind a redirect" error.
          const response = await fetch('/sw.js', { cache: 'no-store' });

          if (!response.ok) {
            console.error('Service Worker script not found or failed to load.', response.statusText);
            return;
          }

          if (response.redirected) {
            console.error('Service Worker script was redirected, which is not allowed.');
            return;
          }

          // Proceed with registration if the preflight check passes.
          const registration = await navigator.serviceWorker.register('/sw.js');
          console.log('Service Worker registered with scope:', registration.scope);
        } catch (error) {
          console.error('Service Worker registration failed:', error);
        }
      };
      
      // Wait for the window to load before registering to avoid resource contention.
      window.addEventListener('load', registerServiceWorker);
      
      // Cleanup the event listener when the component unmounts.
      return () => window.removeEventListener('load', registerServiceWorker);
    }
  }, []);

  return null; // This component doesn't render anything
};

export default PwaInstaller;
