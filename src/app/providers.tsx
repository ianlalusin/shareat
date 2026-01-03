
"use client";

import { AuthContextProvider } from '@/context/auth-context';
import { FirstLoginGuard } from '@/components/auth/first-login-guard';
import { StoreContextProvider } from '@/context/store-context';
import { FirebaseClientProvider } from '@/firebase/client-provider';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <FirebaseClientProvider>
            {/* AuthContextProvider is already provided in the RootLayout, wrapping this */}
            <StoreContextProvider>
                <FirstLoginGuard>
                    {children}
                </FirstLoginGuard>
            </StoreContextProvider>
        </FirebaseClientProvider>
    );
}
