"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useGithubApp } from "@/hooks/useGithubApp";
import { useWorkspace } from "@/hooks/useWorkspace";
import { formatRelativeOrDate } from "@/lib/date-utils";
import { ExternalLink, Github, Loader2 } from "lucide-react";
import { useState } from "react";

export function GitHubStatusWidget() {
  const { workspace, slug } = useWorkspace();
  const { hasTokens: hasGithubAppTokens, isLoading: isGithubAppLoading } = useGithubApp(slug);
  const [isInstalling, setIsInstalling] = useState(false);

  const handleGithubAppInstall = async () => {
    if (!slug) return;

    setIsInstalling(true);
    try {
      const response = await fetch("/api/github/app/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workspaceSlug: slug }),
      });

      const data = await response.json();

      if (data.success && data.data?.link) {
        window.location.href = data.data.link;
      } else {
        setIsInstalling(false);
        toast.error("Installation Failed", { description: data.message || "Failed to generate GitHub App installation link" });
      }
    } catch (error) {
      console.error("Failed to install GitHub App:", error);
      setIsInstalling(false);
      toast.error("Installation Failed", { description: "An error occurred while trying to install the GitHub App" });
    }
  };

  if (isGithubAppLoading) {
    return (
      <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If no GitHub connection, show "Link GitHub" button
  if (!hasGithubAppTokens) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={handleGithubAppInstall}
        disabled={isInstalling}
        className="h-10 px-3 gap-2 bg-card/95 backdrop-blur-sm border-border hover:bg-accent/95"
      >
        <Github className="w-4 h-4" />
        {isInstalling ? "Linking..." : "Link GitHub"}
        <ExternalLink className="w-3 h-3" />
      </Button>
    );
  }

  const repository = workspace?.repositories?.[0];
  const status = repository?.status || "PENDING";
  const lastUpdated = repository?.updatedAt;

  // Determine status color
  const statusColor = status === "SYNCED" ? "bg-green-500" : status === "PENDING" ? "bg-yellow-500" : "bg-red-500";

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
            <Github className="w-5 h-5 text-foreground" />
            <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${statusColor}`} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1.5 text-xs">
            <div className={`font-medium ${status === "SYNCED" ? "text-green-600" : status === "PENDING" ? "text-yellow-600" : "text-red-600"}`}>
              {status}
            </div>
            {lastUpdated && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{formatRelativeOrDate(lastUpdated)}</span>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
