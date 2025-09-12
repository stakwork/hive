"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

export function useTokenRefresh() {
  const { data: session, status, update } = useSession();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    // Check if we need to refresh the session
    const checkTokenRefresh = async () => {
      if (status === "authenticated" && session && !(session as any).error) {
        const now = new Date();
        
        // Refresh session every 10 minutes if active
        if (!lastRefresh || now.getTime() - lastRefresh.getTime() > 10 * 60 * 1000) {
          try {
            setIsRefreshing(true);
            await update(); // Trigger session refresh
            setLastRefresh(now);
          } catch (error) {
            console.error("Failed to refresh session:", error);
          } finally {
            setIsRefreshing(false);
          }
        }
      }
    };

    const interval = setInterval(checkTokenRefresh, 5 * 60 * 1000); // Check every 5 minutes
    return () => clearInterval(interval);
  }, [session, status, update, lastRefresh]);

  return {
    isRefreshing,
    hasError: (session as any)?.error === "RefreshAccessTokenError",
    lastRefresh,
  };
}