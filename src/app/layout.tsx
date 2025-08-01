import type { Metadata } from "next";
import "./globals.css";
import SessionProvider from "@/providers/SessionProvider";
import { ThemeProvider } from "@/providers/theme-provider";
import { ToastProvider } from "@/components/ui/toast-provider";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import DebugMessageListener from "@/components/DebugMessageListener";

export const metadata: Metadata = {
  title: "Hive",
  description: "A fresh start",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <ToastProvider>
          <ThemeProvider defaultTheme="system" storageKey="theme">
            <SessionProvider>
              <WorkspaceProvider>
                <DebugMessageListener />
                {children}
              </WorkspaceProvider>
            </SessionProvider>
          </ThemeProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
