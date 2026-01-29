
"use client";

import { AuthContextProvider } from '@/context/auth-context';
import { StoreContextProvider } from '@/context/store-context';
import { FirebaseClientProvider } from '@/firebase/client-provider';

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
