"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCallback } from "react";

interface GitHubAppConnectorProps {
  repositoryUrl: string;
  workspaceSlug: string;
  error?: string;
  onReconnecting?: () => void;
}

export function GitHubAppConnector({ repositoryUrl, workspaceSlug, error, onReconnecting }: GitHubAppConnectorProps) {
  // Handle GitHub App reconnection
  const handleReconnectGitHub = useCallback(async () => {
    if (repositoryUrl && workspaceSlug) {
      onReconnecting?.();

      try {
        const installResponse = await fetch("/api/github/app/install", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceSlug: workspaceSlug,
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
        // Could add error handling/toast here
      }
    }
  }, [repositoryUrl, workspaceSlug, onReconnecting]);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Repository Access Required</CardTitle>
        <CardDescription>
          We don&apos;t have push access to your repository. Please reinstall the GitHub App to grant the necessary
          permissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {repositoryUrl && <p className="text-sm text-muted-foreground">Repository: {repositoryUrl}</p>}
        {error && <p className="text-sm text-red-600">Error: {error}</p>}
        <Button onClick={handleReconnectGitHub} className="w-full">
          Reconnect GitHub App
        </Button>
      </CardContent>
    </Card>
  );
}
