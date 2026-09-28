import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import '@/styles/globals.css';

// Self-hosted rather than pulled from next/font/google. Google Fonts is
// fetched at build time, so a network blip against fonts.gstatic.com fails the
// whole build. Manrope is the BRICK family display face and is used on
// the hub cover so this app reads as part of the same fleet.
const inter = localFont({
  src: './fonts/inter-latin-var.woff2',
  variable: '--font-inter',
  weight: '100 900',
  display: 'swap',
});

const manrope = localFont({
  src: './fonts/manrope-latin-var.woff2',
  variable: '--font-manrope',
  weight: '200 800',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'LFIQ Onboarding Manual',
  description: 'Complete guide to the LFIQ tech stack for new team members',
  openGraph: {
    title: 'LFIQ Onboarding Manual',
    description: 'Complete guide to the LFIQ tech stack for new team members',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'LFIQ Onboarding Manual',
      },
    ],
  },
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${manrope.variable} font-sans antialiased`}
      >
        {/*
         * Header and Footer belong to the whole manual, not just /docs.
         * They briefly lived in src/app/docs/layout.tsx while `/` was the
         * Green Monster hub cover, which deliberately wore no manual
         * chrome. With the hub removed and `/` back to being the manual's
         * landing page, chrome scoped to /docs left the landing page with
         * no header, footer or navigation at all.
         */}
        <div className="flex flex-col min-h-screen">
          <Header />
          <main className="flex-1 mt-16">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
