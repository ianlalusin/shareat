
"use client";

import { AuthContextProvider } from '@/context/auth-context';
import { FirstLoginGuard } from '@/components/auth/first-login-guard';
import { StoreContextProvider } from '@/context/store-context';
import dynamic from 'next/dynamic';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { FirebaseClientProvider } from '@/firebase/client-provider';

// This was the issue. By dynamically importing the provider with SSR disabled,
// we ensure that Firebase, which needs the browser `window` object,
// only tries to initialize on the client. This resolves the chunk load error
// during server rendering.
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
                    <FirstLoginGuard>
                        {children}
                    </FirstLoginGuard>
                </StoreContextProvider>
            </AuthContextProvider>
        </NoSsrFirebaseProvider>
    );
}
