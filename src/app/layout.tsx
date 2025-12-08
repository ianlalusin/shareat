import type { Metadata } from "next";
import { Baloo_2, Poppins } from 'next/font/google';
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from "@/firebase/client-provider";
import { cn } from "@/lib/utils";

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

export const metadata: Metadata = {
  title: "SharEat Hub",
  description: "POS KDS app for SharEat",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn("font-body antialiased", fontBody.variable, fontHeadline.variable)}>
        <FirebaseClientProvider>
          {children}
          <Toaster />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
