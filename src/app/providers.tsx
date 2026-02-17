
"use client";

import { AuthContextProvider } from '@/context/auth-context';
import { StoreContextProvider } from '@/context/store-context';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { Capacitor } from '@capacitor/core';
import { useEffect } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        // Register the service worker only in the browser, not in the native app.
        // This is disabled for now to prevent errors in some development environments.
        // if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        //     if (!Capacitor.isNativePlatform()) {
        //         navigator.serviceWorker.register('/sw.js').then(
        //             (registration) => {
        //                 console.log('Service Worker registration successful with scope: ', registration.scope);
        //             },
        //             (err) => {
        //                 console.log('Service Worker registration failed: ', err);
        //             }
        //         );
        //     }
        // }
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
