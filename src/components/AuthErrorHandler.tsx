"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { signOut } from "next-auth/react";

export function AuthErrorHandler() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // Handle refresh token errors
    if ((session as any)?.error === "RefreshAccessTokenError") {
      console.log("Session expired, redirecting to sign in...");
      
      // Sign out and redirect to sign in page
      signOut({
        callbackUrl: "/auth/signin",
        redirect: true,
      }).catch((error) => {
        console.error("Error during sign out:", error);
        // Fallback: force navigation to sign in
        router.push("/auth/signin");
      });
    }
  }, [session, router]);

  // Don't render anything, this is just for handling errors
  return null;
}