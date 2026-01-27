"use client";

import React from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useGithubApp } from "@/hooks/useGithubApp";
import { useWorkspace } from "@/hooks/useWorkspace";
import { formatDuration } from "@/lib/date-utils";
import { BarChart3, GitMerge, GitPullRequest, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface PRMetricsResponse {
  successRate: number | null;
  avgTimeToMerge: number | null;
  prCount: number;
  mergedCount: number;
}

export function PRMetricsWidget() {
  const { workspace, slug } = useWorkspace();
  const { hasTokens: hasGithubAppTokens, isLoading: isGithubAppLoading } = useGithubApp(slug);

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

  // Don't render anything if no GitHub connection or still loading auth
  if (isGithubAppLoading || !hasGithubAppTokens) {
    return null;
  }

  // Loading metrics
  if (isMetricsLoading) {
    return (
      <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state
  if (isError || !prMetrics) {
    return (
      <HoverCard openDelay={100}>
        <HoverCardTrigger asChild>
          <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
            <BarChart3 className="w-5 h-5 text-foreground" />
          </div>
        </HoverCardTrigger>
        <HoverCardContent side="bottom" align="end" className="w-auto bg-card border-border">
          <p className="text-sm text-muted-foreground">Failed to load PR metrics</p>
        </HoverCardContent>
      </HoverCard>
    );
  }

  // Zero state - no PR activity
  if (prMetrics.prCount === 0) {
    return (
      <HoverCard openDelay={100}>
        <HoverCardTrigger asChild>
          <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
            <BarChart3 className="w-5 h-5 text-muted-foreground" />
          </div>
        </HoverCardTrigger>
        <HoverCardContent side="bottom" align="end" className="w-auto bg-card border-border">
          <p className="text-sm text-muted-foreground">No PRs in last 72h</p>
        </HoverCardContent>
      </HoverCard>
    );
  }

  const successRateDisplay = prMetrics.successRate !== null ? `${Math.round(prMetrics.successRate)}%` : "N/A";
  const avgTimeDisplay = formatDuration(prMetrics.avgTimeToMerge);

  return (
    <HoverCard openDelay={100}>
      <HoverCardTrigger asChild>
        <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
          <BarChart3 className="w-5 h-5 text-foreground" />
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="end" className="w-auto bg-card border-border">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <GitPullRequest className="w-4 h-4 text-green-600" />
              <span className="font-semibold text-green-600">{prMetrics.prCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <GitMerge className="w-4 h-4 text-purple-600" />
              <span className="font-semibold text-purple-600">{prMetrics.mergedCount}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{avgTimeDisplay} avg</span>
            <span>•</span>
            <span>{successRateDisplay} success</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
