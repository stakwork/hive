import { ToastProvider } from "@/components/ui/toast-provider";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import SessionProvider from "@/providers/SessionProvider";
import { ThemeProvider } from "@/providers/theme-provider";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import ModalClient from "./ModalClient";
import QueryProvider from "@/providers/QueryProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hive",
  description: "A PMs dream",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="staktrak-config" strategy="beforeInteractive">
          {`window.STAKTRAK_CONFIG = { maxTraversalDepth: 10 };`}
        </Script>
        <Script src="/js/staktrak.js" />
        <Script src="/js/playwright-generator.js" />
      </head>
      <body className={`${inter.className} min-h-screen bg-background text-foreground antialiased`}>
        <ToastProvider>
          <ThemeProvider defaultTheme="system" storageKey="theme">
            <SessionProvider>
              <WorkspaceProvider>
                <QueryProvider>
                  <ModalClient>{children}</ModalClient>
                </QueryProvider>
              </WorkspaceProvider>
            </SessionProvider>
          </ThemeProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
