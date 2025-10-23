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
const checkRepositoryAccess = async (repoUrl: string): Promise<{
  hasAccess: boolean;
  error?: string;
  requiresReauth?: boolean;
  requiresInstallationUpdate?: boolean;
  installationId?: number;
}> => {
  try {
    const statusResponse = await fetch(`/api/github/app/check?repositoryUrl=${encodeURIComponent(repoUrl)}`);
    const statusData = await statusResponse.json();

    console.log("statusData", statusData);

    // If there's an error, treat it as no access
    if (statusData.error) {
      return {
        hasAccess: false,
        error: statusData.error,
        requiresReauth: statusData.requiresReauth,
        requiresInstallationUpdate: statusData.requiresInstallationUpdate,
        installationId: statusData.installationId
      };
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
  const [installationId, setInstallationId] = useState<number | undefined>();
  const [errorType, setErrorType] = useState<'reauth' | 'installation-update' | 'other'>('other');

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
          setInstallationId(result.installationId);

          // Determine the type of error
          if (result.requiresReauth) {
            setErrorType('reauth');
          } else if (result.requiresInstallationUpdate) {
            setErrorType('installation-update');
          } else {
            setErrorType('other');
          }

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

  const [installationLink, setInstallationLink] = useState<string | null>(null);

  // Get GitHub App installation link
  const getInstallationLink = useCallback(async () => {
    if (!workspace?.slug) {
      console.error("No workspace slug available for GitHub App installation");
      return;
    }

    try {
      const installResponse = await fetch("/api/github/app/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceSlug: workspace.slug,
          repositoryUrl,
          installationId,
          isExtend: errorType === 'installation-update',
        }),
      });

      const installData = await installResponse.json();

      if (installData.success && installData.data?.link) {
        setInstallationLink(installData.data.link);
      } else {
        throw new Error(installData.message || "Failed to generate GitHub App installation link");
      }
    } catch (error) {
      console.error("Failed to get GitHub App installation link:", error);
    }
  }, [repositoryUrl, workspace?.slug, installationId, errorType]);

  // Get installation link when we determine access is needed
  useEffect(() => {
    if (accessState === 'no-access' && !installationLink) {
      getInstallationLink();
    }
  }, [accessState, installationLink, getInstallationLink]);

  // Handle GitHub App reconnection
  const handleReconnectGitHub = useCallback(() => {
    if (installationLink) {
      if (errorType === 'installation-update') {
        // For isExtend cases, just open the link directly
        window.open(installationLink, '_blank', 'noopener,noreferrer');
      } else {
        // For new installations, could also just open directly
        window.open(installationLink, '_blank', 'noopener,noreferrer');
      }
    }
  }, [installationLink, errorType]);

  // Show nothing while checking access (silent check)
  if (accessState === 'checking') {
    return null;
  }

  // Show access error if user doesn't have repository access
  if (accessState === 'no-access') {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Repository Access Required</CardTitle>
          <CardDescription>
            {errorType === 'installation-update' ? (
              <>We don&apos;t have access to this repository. Please update your GitHub App installation to include this repository.</>
            ) : (
              <>We don&apos;t have push access to your repository. Please reinstall the GitHub App to grant the necessary permissions.</>
            )}
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

          {errorType === 'installation-update' && installationLink ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Click the link below to open your GitHub App installation settings and add this repository:
              </p>
              <a
                href={installationLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-blue-600 hover:text-blue-800 underline text-sm font-medium"
              >
                Open GitHub App Installation Settings →
              </a>
            </div>
          ) : (
            <Button
              onClick={handleReconnectGitHub}
              className="w-full"
              disabled={!installationLink}
            >
              {!installationLink ? 'Generating link...' : 'Open GitHub App Installation'}
            </Button>
          )}

          <p className="text-xs text-muted-foreground mt-2">
            After configuring access on GitHub, refresh this page to continue.
          </p>
        </CardContent>
      </Card>
    );
  }

  return null;
}