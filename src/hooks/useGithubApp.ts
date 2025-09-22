"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface GithubAppStatus {
  hasTokens: boolean;
  isLoading: boolean;
  error: string | null;
  checkAppInstallation: (ownerName: string) => Promise<{ installed: boolean; installationId?: number; type?: 'user' | 'org' }>;
}

export function useGithubApp(): GithubAppStatus {
  const { data: session, status } = useSession();
  const [hasTokens, setHasTokens] = useState(false);
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

        const response = await fetch("/api/github/app/status", {
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
      } catch (err) {
        console.error("Error checking GitHub App status:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setHasTokens(false);
      } finally {
        setIsLoading(false);
      }
    }

    checkGithubAppStatus();
  }, [session?.user?.id, status]);

  const checkAppInstallation = async (ownerName: string) => {
    console.log(`🔍 Checking GitHub app installation for: ${ownerName}`);

    try {
      const response = await fetch(`/api/github/app/check-installation?owner=${encodeURIComponent(ownerName)}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.log(`❌ Failed to check installation for ${ownerName}:`, response.status, response.statusText);
        return { installed: false };
      }

      const data = await response.json();
      console.log(`✅ Installation check result for ${ownerName}:`, data);

      return {
        installed: data.installed || false,
        installationId: data.installationId,
        type: data.type
      };
    } catch (err) {
      console.error(`💥 Error checking installation for ${ownerName}:`, err);
      return { installed: false };
    }
  };

  return {
    hasTokens,
    isLoading,
    error,
    checkAppInstallation,
  };
}
