import { Toaster } from "@/components/ui/sonner";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import SessionProvider from "@/providers/SessionProvider";
import { ThemeProvider } from "@/providers/theme-provider";
import type { Metadata, Viewport } from "next";
import { Inter, Roboto } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import ModalClient from "./ModalClient";
import QueryProvider from "@/providers/QueryProvider";
import { getMetadata } from "@/lib/metadata";
import { config } from "@/config/env";
import DevPanel from "@/components/DevPanel";

const inter = Inter({ subsets: ["latin"] });
const roboto = Roboto({
  weight: ['400', '500', '700'],
  subsets: ["latin"],
  variable: '--font-roboto',
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = getMetadata();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="staktrak-config" strategy="beforeInteractive">
          {`window.STAKTRAK_CONFIG = {
            maxTraversalDepth: 10,
            parentOrigin: window.location.origin,
            screenshot: {
              quality: 0.8,
              type: 'image/jpeg',
              backgroundColor: '#ffffff'
            }
          };`}
        </Script>
        <Script src="/js/staktrak.js" />
        <Script src="/js/playwright-generator.js" />
      </head>
      <body className={`${inter.className} ${roboto.variable} min-h-screen bg-background text-foreground antialiased`}>
        <ThemeProvider defaultTheme="system" storageKey="theme">
          <SessionProvider>
            <WorkspaceProvider>
              <QueryProvider>
                <ModalClient>{children}</ModalClient>
              </QueryProvider>
            </WorkspaceProvider>
          </SessionProvider>
        </ThemeProvider>
        {config.USE_MOCKS && <DevPanel />}
        <Toaster />
      </body>
    </html>
  );
}
