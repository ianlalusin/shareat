
"use client";

import { AuthContextProvider } from '@/context/auth-context';
import { FirstLoginGuard } from '@/components/auth/first-login-guard';
import { StoreContextProvider } from '@/context/store-context';
import dynamic from 'next/dynamic';
import { BrandLoader } from '@/components/ui/BrandLoader';

// Dynamically import the FirebaseClientProvider with SSR disabled.
// This is crucial for preventing errors related to server-side execution of client-side Firebase code.
const FirebaseClientProvider = dynamic(
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
        <FirebaseClientProvider>
            <AuthContextProvider>
                <StoreContextProvider>
                    <FirstLoginGuard>
                        {children}
                    </FirstLoginGuard>
                </StoreContextProvider>
            </AuthContextProvider>
        </FirebaseClientProvider>
    );
}
