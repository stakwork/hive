"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
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

function getStateContent(
  errorType: string,
  error: string | null,
): { title: string; description: string; buttonText?: string } {
  if (errorType === "reauth") {
    return {
      title: "GitHub Connection Expired",
      description: "Your GitHub token is no longer valid. Reconnect your account to restore access.",
      buttonText: "Reconnect GitHub",
    };
  }

  if (errorType === "installation-update") {
    return {
      title: "Repository Not Accessible",
      description: "This repository hasn't been added to the GitHub App. Grant access to continue.",
      buttonText: "Grant Access on GitHub",
    };
  }

  if (errorType === "no-cta") {
    if (error === "user_not_authorised") {
      return {
        title: "Access Not Granted",
        description:
          "You're a member of this workspace but don't have access to this repository. Contact a workspace admin.",
      };
    }
    return {
      title: "Insufficient Permissions",
      description:
        "You don't have write access to this repository. Contact a workspace admin to be granted the correct permissions.",
    };
  }

  // errorType === 'other'
  if (error === "Failed to check repository access") {
    return {
      title: "Something Went Wrong",
      description: "We couldn't check your repository access. Refresh the page to try again.",
    };
  }

  return {
    title: "GitHub App Not Installed",
    description: "The GitHub App needs to be installed for this organisation to continue.",
    buttonText: "Install GitHub App",
  };
}

export function GitHubAccessManager({ repositoryUrl, onAccessError }: GitHubAccessManagerProps) {
  const { workspace } = useWorkspace();
  const [accessState, setAccessState] = useState<"checking" | "no-access" | "reconnecting">(
    "checking",
  );
  const [installationId, setInstallationId] = useState<number | undefined>();
  const [errorType, setErrorType] = useState<
    "reauth" | "installation-update" | "other" | "no-cta"
  >("other");
  const [error, setError] = useState<string | null>(null);
  const [installationLink, setInstallationLink] = useState<string | null>(null);

  useEffect(() => {
    const checkAccess = async () => {
      setAccessState("checking");

      try {
        const result = await checkRepositoryAccess(repositoryUrl);

        if (result.hasAccess) {
          setError(null);
          onAccessError(false);
        } else {
          onAccessError(true);
          setAccessState("no-access");
          setInstallationId(result.installationId);

          if (result.requiresReauth) {
            setErrorType("reauth");
          } else if (result.requiresInstallationUpdate) {
            setErrorType("installation-update");
          } else if (result.error === "user_not_authorised") {
            setErrorType("no-cta");
          } else if (!result.error && !result.hasAccess) {
            setErrorType("no-cta");
          } else {
            setErrorType("other");
          }

          setError(result.error || null);
        }
      } catch (err) {
        console.error("Error checking repository access:", err);
        setAccessState("no-access");
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
          isExtend: errorType === "installation-update",
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
    if (accessState === "no-access" && !installationLink && errorType !== "no-cta") {
      getInstallationLink();
    }
  }, [accessState, installationLink, errorType, getInstallationLink]);

  if (accessState === "checking") {
    return null;
  }

  if (accessState === "no-access") {
    const { title, description, buttonText } = getStateContent(errorType, error);

    return (
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Github className="size-5" />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Badge variant="outline" className="font-mono text-xs">
            {extractRepoName(repositoryUrl)}
          </Badge>

          {buttonText && (
            <>
              {installationLink ? (
                <Button asChild>
                  <a href={installationLink} target="_blank" rel="noopener noreferrer">
                    {buttonText}
                  </a>
                </Button>
              ) : (
                <Button disabled>
                  <Loader2 className="animate-spin" />
                  Loading...
                </Button>
              )}

              <p className="text-xs text-muted-foreground">After granting access, refresh this page.</p>
            </>
          )}
        </EmptyContent>
      </Empty>
    );
  }

  return null;
}
