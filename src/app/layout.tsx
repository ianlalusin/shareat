'use client';

import type { Metadata } from "next";
import { Baloo_2, Poppins } from 'next/font/google';
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from "@/firebase/client-provider";
import { cn } from "@/lib/utils";
import { AuthContextProvider } from "@/context/auth-context";
import { SettingsProvider } from "@/context/settings-context";
import { useRegisterServiceWorker } from "./_sw-client";

const fontBody = Poppins({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600'],
  variable: '--font-body',
});

const fontHeadline = Baloo_2({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '700'],
  variable: '--font-headline',
});

// Since this is a client component, we can't export metadata directly.
// This information should be moved to the <head> tag below.

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  useRegisterServiceWorker();
  
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>SharEat Hub</title>
        <meta name="description" content="POS KDS app for SharEat" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#000000" />
      </head>
      <body className={cn("font-body antialiased", fontBody.variable, fontHeadline.variable)}>
        <FirebaseClientProvider>
          <AuthContextProvider>
            <SettingsProvider>
              {children}
            </SettingsProvider>
          </AuthContextProvider>
          <Toaster />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
