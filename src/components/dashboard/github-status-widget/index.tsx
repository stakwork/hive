"use client";

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
import { formatDuration } from "@/lib/date-utils";
import { ExternalLink, Github, Loader2 } from "lucide-react";
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";

interface PRMetricsResponse {
  successRate: number | null;
  avgTimeToMerge: number | null;
  prCount: number;
  mergedCount: number;
}

export function GitHubStatusWidget() {
  const { workspace, slug } = useWorkspace();
  const { hasTokens: hasGithubAppTokens, isLoading: isGithubAppLoading } = useGithubApp(slug);
  const [isInstalling, setIsInstalling] = useState(false);

  // Fetch PR metrics when connected
  const { data: prMetrics, isLoading: isMetricsLoading, isError } = useQuery<PRMetricsResponse>({
    queryKey: ["pr-metrics", workspace?.id],
    queryFn: async () => {
      const response = await fetch(`/api/github/pr-metrics?workspaceId=${workspace?.id}`);
      if (!response.ok) throw new Error("Failed to fetch PR metrics");
      return response.json();
    },
    enabled: !!workspace?.id && hasGithubAppTokens,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

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

  // Loading metrics
  if (isMetricsLoading) {
    return (
      <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state - show red indicator
  if (isError || !prMetrics) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <div className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
              <Github className="w-5 h-5 text-foreground" />
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="text-xs text-red-600">Failed to load PR metrics</div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Zero state - no PR activity
  if (prMetrics.prCount === 0) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <div className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
              <Github className="w-5 h-5 text-muted-foreground" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="text-xs text-muted-foreground">No PR activity</div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Determine color based on success rate
  const getStatusColor = (rate: number | null) => {
    if (rate === null) return "bg-red-500";
    if (rate > 70) return "bg-green-500";
    if (rate >= 50) return "bg-yellow-500";
    return "bg-red-500";
  };

  const statusColor = getStatusColor(prMetrics.successRate);
  const successRateDisplay = prMetrics.successRate !== null ? `${Math.round(prMetrics.successRate)}%` : "N/A";
  const avgTimeDisplay = formatDuration(prMetrics.avgTimeToMerge);

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
            <div className="font-medium">
              72h PR Activity: {prMetrics.mergedCount} merged / {prMetrics.prCount} opened • Avg: {avgTimeDisplay}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>Success Rate: {successRateDisplay}</span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
