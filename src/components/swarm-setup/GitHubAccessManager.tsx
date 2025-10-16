"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useCallback, useEffect, useState } from "react";

interface GitHubAccessManagerProps {
  repositoryUrl: string;
  onAccessResult: (hasAccess: boolean, error?: string) => void;
  error?: string;
}

// Check if user has access to repository
const checkRepositoryAccess = async (repoUrl: string): Promise<{ hasAccess: boolean; error?: string }> => {
  try {
    const statusResponse = await fetch(`/api/github/app/check?repositoryUrl=${encodeURIComponent(repoUrl)}`);
    const statusData = await statusResponse.json();

    console.log("statusData", statusData);

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

export function GitHubAccessManager({ repositoryUrl, onAccessResult, error }: GitHubAccessManagerProps) {
  const { workspace } = useWorkspace();
  const [accessState, setAccessState] = useState<'checking' | 'no-access' | 'reconnecting'>('checking');

  // Check repository access when component mounts
  useEffect(() => {
    const checkAccess = async () => {
      setAccessState('checking');

      try {
        const result = await checkRepositoryAccess(repositoryUrl);

        if (result.hasAccess) {
          onAccessResult(true);
        } else {
          setAccessState('no-access');
          onAccessResult(false, result.error);
        }
      } catch (error) {
        console.error("Error checking repository access:", error);
        setAccessState('no-access');
        onAccessResult(false, "Failed to check repository access");
      }
    };

    checkAccess();
  }, [repositoryUrl, onAccessResult]);

  // Handle GitHub App reconnection
  const handleReconnectGitHub = useCallback(async () => {
    if (!workspace?.slug) {
      console.error("No workspace slug available for GitHub App installation");
      setAccessState('no-access');
      return;
    }

    setAccessState('reconnecting');

    try {
      const installResponse = await fetch("/api/github/app/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceSlug: workspace.slug,
          repositoryUrl,
        }),
      });

      const installData = await installResponse.json();

      if (installData.success && installData.data?.link) {
        // Navigate to GitHub App installation
        window.location.href = installData.data.link;
        return; // Don't reset loading state since we're redirecting
      } else {
        throw new Error(installData.message || "Failed to generate GitHub App installation link");
      }
    } catch (error) {
      console.error("Failed to initiate GitHub App connection:", error);
      setAccessState('no-access');
    }
  }, [repositoryUrl, workspace?.slug]);

  // Show nothing while checking access (silent check)
  if (accessState === 'checking') {
    return null;
  }

  // Show access error if user doesn't have repository access
  if (accessState === 'no-access' || accessState === 'reconnecting') {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Repository Access Required</CardTitle>
          <CardDescription>
            We don&apos;t have push access to your repository. Please {accessState === 'reconnecting' ? 'wait while we redirect you to' : 'reinstall the'} GitHub App to grant the necessary permissions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Repository: {repositoryUrl}
          </p>
          {error && (
            <p className="text-sm text-red-600">
              Error: {error}
            </p>
          )}
          <Button
            onClick={handleReconnectGitHub}
            className="w-full"
            disabled={accessState === 'reconnecting'}
          >
            {accessState === 'reconnecting' ? 'Redirecting...' : 'Reconnect GitHub App'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}