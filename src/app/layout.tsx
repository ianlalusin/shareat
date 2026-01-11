import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';
import { Baloo_2, Poppins } from 'next/font/google';
import { cn } from '@/lib/utils';
import { Providers } from './providers';
import { AppLayout } from '@/components/layout/AppLayout';

// Define fonts
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable
        )}
      >
        <Providers>
          <AppLayout>
            {children}
          </AppLayout>
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
