"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import { AuthErrorHandler } from "@/components/AuthErrorHandler";

interface SessionProviderProps {
  children: React.ReactNode;
  session?: any;
}

export default function SessionProvider({ children, session }: SessionProviderProps) {
  return (
    <NextAuthSessionProvider 
      session={session}
      // Refetch session when window gains focus
      refetchOnWindowFocus={true}
      // Refetch session every 5 minutes
      refetchInterval={5 * 60}
      // Refetch when coming back online
      refetchWhenOffline={false}
    >
      <AuthErrorHandler />
      {children}
    </NextAuthSessionProvider>
  );
}

// Named export for compatibility
export { SessionProvider };