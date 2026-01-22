
"use client";

import { AuthContextProvider } from '@/context/auth-context';
import { StoreContextProvider } from '@/context/store-context';
import dynamic from 'next/dynamic';
import { BrandLoader } from '@/components/ui/BrandLoader';

const NoSsrFirebaseProvider = dynamic(
    () => import('@/firebase/client-provider').then(mod => mod.FirebaseClientProvider),
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
        <NoSsrFirebaseProvider>
            <AuthContextProvider>
                <StoreContextProvider>
                    {children}
                </StoreContextProvider>
            </AuthContextProvider>
        </NoSsrFirebaseProvider>
    );
}
