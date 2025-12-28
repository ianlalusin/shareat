import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/toaster';
import Header from '@/components/layout/header';
import './globals.css';
import { Baloo_2, Poppins } from 'next/font/google';
import { cn } from '@/lib/utils';
import { AuthContextProvider } from '@/context/auth-context';
import { FirstLoginGuard } from '@/components/auth/first-login-guard';
import AuthLayout from '@/components/layout/auth-layout';
import { StoreContextProvider } from '@/context/store-context';


const fontSans = Poppins({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ['400', '500', '600', '700']
})

const fontSerif = Baloo_2({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ['400', '700']
})

export const metadata: Metadata = {
  title: 'SharEat Hub',
  description: 'The complete solution for restaurant management.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable,
          fontSerif.variable
        )}>
        <AuthContextProvider>
          <StoreContextProvider>
            <FirstLoginGuard>
              <AuthLayout>
                {children}
              </AuthLayout>
            </FirstLoginGuard>
          </StoreContextProvider>
        </AuthContextProvider>
        <Toaster />
      </body>
    </html>
  );
}

    