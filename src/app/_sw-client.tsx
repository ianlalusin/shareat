'use client';

import { useEffect } from 'react';

export function useRegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js')
            .catch((err) => {
                console.error('SW registration failed', err);
            });
    });
  }, []);
}
