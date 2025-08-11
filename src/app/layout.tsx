import type { Metadata } from "next";
import "./globals.css";
import SessionProvider from "@/providers/SessionProvider";
import { ThemeProvider } from "@/providers/theme-provider";
import { ToastProvider } from "@/components/ui/toast-provider";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Hive",
  description: "A fresh start",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="staktrak-config" strategy="beforeInteractive">
          {`window.STAKTRAK_CONFIG = { maxTraversalDepth: 10 };`}
        </Script>
        <Script src="/js/staktrak.js" />
        <Script src="/js/replay.js" />
        <Script src="/js/playwright-generator.js" type="module" />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <ToastProvider>
          <ThemeProvider defaultTheme="system" storageKey="theme">
            <SessionProvider>
              <WorkspaceProvider>
                {children}
              </WorkspaceProvider>
            </SessionProvider>
          </ThemeProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
