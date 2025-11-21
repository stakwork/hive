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
    // Reduce refetch interval to prevent excessive requests
    >
      {children}
    </NextAuthSessionProvider>
  );
}
