import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { TabBar } from "@/components/tab-bar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FINN",
  description: "Your holdings, judged against your thesis. A brief of what changed, and research on any NSE ticker.",
  applicationName: "FINN",
  appleWebApp: { title: "FINN", statusBarStyle: "black-translucent", capable: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0e" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-dvh">
        <Providers>
          <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col sm:border-x sm:border-line">
            <main className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">{children}</main>
          </div>
          {/* The tab bar reads the pathname, which suspends under dynamic routes with Cache Components. */}
          <Suspense fallback={null}>
            <TabBar />
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
