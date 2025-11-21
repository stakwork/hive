"use client";

import { useEffect } from "react";

interface RepositoryAccessCheckerProps {
  repositoryUrl: string;
  onAccessResult: (hasAccess: boolean, error?: string) => void;
}

// Check if user has access to repository
const checkRepositoryAccess = async (repoUrl: string): Promise<{ hasAccess: boolean; error?: string }> => {
  try {
    const statusResponse = await fetch(`/api/github/app/check?repositoryUrl=${encodeURIComponent(repoUrl)}`);
    const statusData = await statusResponse.json();

    // If there's an error, treat it as no access
    if (statusData.error) {
      return { hasAccess: false, error: statusData.error };
    }

    return { hasAccess: statusData.hasPushAccess === true };
  } catch (error) {
    console.error("Failed to check repository access:", error);
    return { hasAccess: false, error: "Failed to check repository access" };
  }
};

export function RepositoryAccessChecker({ repositoryUrl, onAccessResult }: RepositoryAccessCheckerProps) {
  useEffect(() => {
    if (!repositoryUrl) return;

    const checkAccess = async () => {
      try {
        const result = await checkRepositoryAccess(repositoryUrl);
        onAccessResult(result.hasAccess, result.error);
      } catch (error) {
        console.error("Error checking repository access:", error);
        onAccessResult(false, "Failed to check repository access");
      }
    };

    checkAccess();
  }, [repositoryUrl, onAccessResult]);

  // This component doesn't render anything visible - it's a logic-only component
  // The checking state could be exposed via callback if needed for UI
  return null;
}
