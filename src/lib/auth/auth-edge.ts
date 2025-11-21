// Edge-compatible auth export for middleware
// This file provides a lightweight auth() function that works in Edge Runtime
// without importing the full auth configuration that uses Node crypto

import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";

// Minimal config for middleware - no callbacks that use encryption
export const authConfigEdge: NextAuthConfig = {
  providers: [], // Providers are not needed in middleware
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
};

export const { auth: authEdge } = NextAuth(authConfigEdge);
