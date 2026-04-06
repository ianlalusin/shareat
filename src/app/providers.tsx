'use client';

import { AuthContextProvider } from '@/context/auth-context';
import { StoreContextProvider } from '@/context/store-context';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { Capacitor } from '@capacitor/core';
import { useEffect } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        // Register the service worker only in the browser, not in the native app.
        if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
            const isWorkstation = window.location.hostname.endsWith('.cloudworkstations.dev');
            if (!Capacitor.isNativePlatform() && !isWorkstation) {
                navigator.serviceWorker.register('/sw.js').then(
                    (registration) => {
                        console.debug('[SW] Registration successful:', registration.scope);
                    },
                    (err) => {
                        console.warn('[SW] Registration failed:', err);
                    }
                );
            }
        }
    }, []);
    
    return (
        <FirebaseClientProvider>
            <AuthContextProvider>
                <StoreContextProvider>
                    {children}
                </StoreContextProvider>
            </AuthContextProvider>
        </FirebaseClientProvider>
    );
}
