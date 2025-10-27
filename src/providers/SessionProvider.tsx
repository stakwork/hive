"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import { ReactNode } from "react";

interface SessionProviderProps {
  children: ReactNode;
}

export default function SessionProvider({ children }: SessionProviderProps) {
  return (
    <NextAuthSessionProvider
      // Disable automatic session refetch on window focus to prevent network errors
      refetchOnWindowFocus={false}
      // Reduce refetch interval to prevent excessive requests
      refetchInterval={5 * 60} // 5 minutes instead of default
    >
      {children}
    </NextAuthSessionProvider>
  );
}
