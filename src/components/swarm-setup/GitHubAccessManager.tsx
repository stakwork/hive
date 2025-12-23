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
import { Github, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface GitHubAccessManagerProps {
  repositoryUrl: string;
  onAccessError: (error: boolean) => void;
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

  useEffect(() => {
    const checkAccess = async () => {
      setAccessState('checking');

      try {
        const result = await checkRepositoryAccess(repositoryUrl);

        if (result.hasAccess) {
          setError(null);
          onAccessError(false);
        } else {
          onAccessError(true);
          setAccessState('no-access');
          setInstallationId(result.installationId);

          if (result.requiresReauth) {
            setErrorType('reauth');
          } else if (result.requiresInstallationUpdate) {
            setErrorType('installation-update');
          } else {
            setErrorType('other');
          }

          setError(result.error || null);
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
          <Badge variant="outline" className="font-mono text-xs">
            {extractRepoName(repositoryUrl)}
          </Badge>

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
