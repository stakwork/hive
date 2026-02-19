"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyContent,
} from "@/components/ui/empty";
import { useWorkspace } from "@/hooks/useWorkspace";
import { checkRepositoryAccess } from "@/lib/github/checkRepositoryAccess";
import { Github, Loader2, CheckCircle, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface GitHubAccessManagerProps {
  repositoryUrl: string;
  onAccessError: (error: boolean) => void;
}

interface RepositoryAccessResult {
  url: string;
  name: string;
  hasAccess: boolean;
  error?: string;
  requiresReauth?: boolean;
  requiresInstallationUpdate?: boolean;
  installationId?: number;
}

function extractRepoName(url: string): string {
  const match = url.match(/github\.com\/(.+)/);
  return match ? match[1] : url;
}

function getButtonText(errorType: string, error: string | null): string {
  if (errorType === "reauth" || error?.includes("token is invalid or expired")) {
    return "Reconnect GitHub";
  }
  if (errorType === "installation-update") {
    return "Grant Access on GitHub";
  }
  return "Install GitHub App";
}

export function GitHubAccessManager({ repositoryUrl, onAccessError }: GitHubAccessManagerProps) {
  const { workspace } = useWorkspace();
  const [accessState, setAccessState] = useState<'checking' | 'no-access' | 'reconnecting'>('checking');
  const [installationId, setInstallationId] = useState<number | undefined>();
  const [errorType, setErrorType] = useState<'reauth' | 'installation-update' | 'other'>('other');
  const [error, setError] = useState<string | null>(null);
  const [installationLink, setInstallationLink] = useState<string | null>(null);
  const [repoResults, setRepoResults] = useState<RepositoryAccessResult[]>([]);

  useEffect(() => {
    const checkAccess = async () => {
      setAccessState('checking');

      try {
        // Parse comma-separated repository URLs
        const repoUrls = repositoryUrl.split(',').map(url => url.trim()).filter(Boolean);
        
        // Check access for all repositories in parallel
        const results = await Promise.all(
          repoUrls.map(async (url) => {
            const result = await checkRepositoryAccess(url);
            return {
              url,
              name: url.split('/').pop() || url,
              hasAccess: result.hasAccess,
              error: result.error,
              requiresReauth: result.requiresReauth,
              requiresInstallationUpdate: result.requiresInstallationUpdate,
              installationId: result.installationId,
            };
          })
        );

        setRepoResults(results);

        // Fail-fast: ALL repositories must have access
        const allHaveAccess = results.every(r => r.hasAccess);
        const firstFailure = results.find(r => !r.hasAccess);

        if (allHaveAccess) {
          setError(null);
          onAccessError(false);
        } else {
          onAccessError(true);
          setAccessState('no-access');
          
          if (firstFailure) {
            setInstallationId(firstFailure.installationId);

            if (firstFailure.requiresReauth) {
              setErrorType('reauth');
            } else if (firstFailure.requiresInstallationUpdate) {
              setErrorType('installation-update');
            } else {
              setErrorType('other');
            }

            setError(firstFailure.error || `Access denied to repository: ${firstFailure.name}`);
          }
        }
      } catch (err) {
        console.error("Error checking repository access:", err);
        setAccessState('no-access');
        onAccessError(true);
        setError("Failed to check repository access");
      }
    };

    checkAccess();
  }, [repositoryUrl, onAccessError]);

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
    } catch (err) {
      console.error("Failed to get GitHub App installation link:", err);
      onAccessError(true);
    }
  }, [repositoryUrl, workspace?.slug, installationId, errorType, onAccessError]);

  useEffect(() => {
    if (accessState === 'no-access' && !installationLink) {
      getInstallationLink();
    }
  }, [accessState, installationLink, getInstallationLink]);

  if (accessState === 'checking') {
    return null;
  }

  if (accessState === 'no-access') {
    return (
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Github className="size-5" />
          </EmptyMedia>
          <EmptyTitle>Repository Access Required</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          {/* Display status for all repositories */}
          <div className="flex flex-col gap-2 w-full max-w-md">
            {repoResults.map((repo, index) => (
              <div key={index} className="flex items-center gap-2 text-sm">
                {repo.hasAccess ? (
                  <CheckCircle className="size-4 text-green-600 shrink-0" />
                ) : (
                  <XCircle className="size-4 text-red-600 shrink-0" />
                )}
                <Badge variant="outline" className="font-mono text-xs">
                  {repo.name}
                </Badge>
                {!repo.hasAccess && (
                  <span className="text-xs text-red-600 ml-auto">Access denied</span>
                )}
              </div>
            ))}
          </div>

          {error && (
            <p className="text-sm text-red-600 mt-2">{error}</p>
          )}

          {installationLink ? (
            <Button asChild>
              <a href={installationLink} target="_blank" rel="noopener noreferrer">
                {getButtonText(errorType, error)}
              </a>
            </Button>
          ) : (
            <Button disabled>
              <Loader2 className="animate-spin" />
              Loading...
            </Button>
          )}

          <p className="text-xs text-muted-foreground">
            After granting access, refresh this page.
          </p>
        </EmptyContent>
      </Empty>
    );
  }

  return null;
}
