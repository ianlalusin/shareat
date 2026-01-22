import type { Metadata, Viewport } from 'next';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';
import { Baloo_2, Poppins } from 'next/font/google';
import { cn } from '@/lib/utils';
import { Providers } from './providers';
import { FirstLoginGuard } from '@/components/auth/first-login-guard';
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

// PWA Metadata
const APP_NAME = "SharEat Hub";
const APP_DEFAULT_TITLE = "SharEat Hub";
const APP_TITLE_TEMPLATE = "%s - SharEat Hub";
const APP_DESCRIPTION = "A complete POS, KDS, and ERP solution for restaurants.";

export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
  applicationName: APP_NAME,
  title: {
    default: APP_DEFAULT_TITLE,
    template: APP_TITLE_TEMPLATE,
  },
  description: APP_DESCRIPTION,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_DEFAULT_TITLE,
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(fontSans.variable, fontSerif.variable)}>
      <body>
        <Providers>
          <FirstLoginGuard>
            {children}
          </FirstLoginGuard>
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
