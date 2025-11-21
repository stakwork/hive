"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

interface GithubAppStatus {
  hasTokens: boolean;
  hasRepoAccess?: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useGithubApp(workspaceSlug?: string): GithubAppStatus {
  const { data: session, status } = useSession();
  const [hasTokens, setHasTokens] = useState(false);
  const [hasRepoAccess, setHasRepoAccess] = useState<boolean | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkGithubAppStatus() {
      if (status === "loading") {
        return;
      }

      if (!session?.user?.id) {
        setIsLoading(false);
        setHasTokens(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        console.log("workspaceSlug-is-here-in-useGithubApp", workspaceSlug);

        const url = workspaceSlug ? `/api/github/app/status?workspaceSlug=${workspaceSlug}` : "/api/github/app/status";

        console.log("url-is-here-in-useGithubApp", url);

        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error("Failed to check GitHub App status");
        }

        const data = await response.json();
        setHasTokens(data.hasTokens || false);
        setHasRepoAccess(data.hasRepoAccess);
      } catch (err) {
        console.error("Error checking GitHub App status:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setHasTokens(false);
      } finally {
        setIsLoading(false);
      }
    }

    checkGithubAppStatus();
  }, [session?.user?.id, status, workspaceSlug]);

  return {
    hasTokens,
    hasRepoAccess,
    isLoading,
    error,
  };
}

/*
staklink universal install cargo
rm HANDLER from the 2 endpoints
*/
