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
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { useWorkspace } from "@/hooks/useWorkspace";
import { checkRepositoryAccess } from "@/lib/github/checkRepositoryAccess";
import { getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { Github, Loader2, RefreshCw } from "lucide-react";
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
  const [accessState, setAccessState] = useState<"checking" | "no-access" | "granted">("checking");
  const [rechecking, setRechecking] = useState(false);
  const [installationId, setInstallationId] = useState<number | undefined>();
  const [errorType, setErrorType] = useState<
    "reauth" | "installation-update" | "other" | "no-cta"
  >("other");
  const [error, setError] = useState<string | null>(null);
  // Keyed by error type: a re-check that lands on a different error needs a new link.
  const [linkState, setLinkState] = useState<{ type: typeof errorType; link: string } | null>(null);
  const installationLink = linkState?.type === errorType ? linkState.link : null;

  /** `recheck` keeps the current screen up while it runs instead of blanking it. */
  const checkAccess = useCallback(
    async (recheck = false) => {
      if (recheck) setRechecking(true);
      else setAccessState("checking");

      try {
        const result = await checkRepositoryAccess(repositoryUrl);

        if (result.hasAccess) {
          setError(null);
          setAccessState("granted");
          onAccessError(false);
        } else {
          onAccessError(true);
          setAccessState("no-access");
          setInstallationId(result.installationId);

          let nextType: typeof errorType;
          if (result.requiresReauth) {
            nextType = "reauth";
          } else if (result.requiresInstallationUpdate) {
            nextType = "installation-update";
          } else if (result.error === "user_not_authorised") {
            nextType = "no-cta";
          } else if (!result.error && !result.hasAccess) {
            nextType = "no-cta";
          } else {
            nextType = "other";
          }
          setErrorType(nextType);

          setError(result.error || null);
        }
      } catch (err) {
        console.error("Error checking repository access:", err);
        setAccessState("no-access");
        onAccessError(true);
        setError("Failed to check repository access");
      } finally {
        setRechecking(false);
      }
    },
    [repositoryUrl, onAccessError],
  );

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  // While blocked, re-check when the user comes back from GitHub (tab focus)
  // and when the GitHub App webhook says the installation changed.
  const waiting = accessState === "no-access";
  const channel = usePusherChannel(waiting && workspace?.slug ? getWorkspaceChannelName(workspace.slug) : null);

  useEffect(() => {
    if (!waiting) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") checkAccess(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [waiting, checkAccess]);

  useEffect(() => {
    if (!channel) return;
    const onUpdate = () => checkAccess(true);
    channel.bind(PUSHER_EVENTS.GITHUB_INSTALLATION_UPDATED, onUpdate);
    return () => {
      channel.unbind(PUSHER_EVENTS.GITHUB_INSTALLATION_UPDATED, onUpdate);
    };
  }, [channel, checkAccess]);

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
        setLinkState({ type: errorType, link: installData.data.link });
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

              <p className="text-xs text-muted-foreground">
                After granting access on GitHub, come back here — we&apos;ll pick it up automatically.
              </p>
            </>
          )}

          <Button variant="ghost" size="sm" onClick={() => checkAccess(true)} disabled={rechecking}>
            <RefreshCw className={rechecking ? "animate-spin" : undefined} />
            {rechecking ? "Checking…" : "Check again"}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return null;
}
