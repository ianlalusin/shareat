"use client";

import { AuthContextProvider } from '@/context/auth-context';
import { FirstLoginGuard } from '@/components/auth/first-login-guard';
import AuthLayout from '@/components/layout/auth-layout';
import { StoreContextProvider } from '@/context/store-context';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <AuthContextProvider>
          <StoreContextProvider>
            <FirstLoginGuard>
              <AuthLayout>
                {children}
              </AuthLayout>
            </FirstLoginGuard>
          </StoreContextProvider>
        </AuthContextProvider>
    );
}
