
"use client";

import { AuthContextProvider } from '@/context/auth-context';
import { StoreContextProvider } from '@/context/store-context';
import dynamic from 'next/dynamic';
import { BrandLoader } from '@/components/ui/BrandLoader';

// Dynamically import the provider that initializes Firebase to ensure it only runs on the client.
const FirebaseClientProvider = dynamic(
    () => import('@/firebase/client-provider').then(m => m.FirebaseClientProvider),
    {
        ssr: false,
        loading: () => (
            <div className="flex items-center justify-center h-screen">
                <BrandLoader />
            </div>
        )
    }
);

export function Providers({ children }: { children: React.ReactNode }) {
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
