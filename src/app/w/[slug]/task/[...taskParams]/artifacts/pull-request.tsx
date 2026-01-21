"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Artifact, PullRequestContent } from "@/lib/chat";
import {
  GitPullRequest,
  GitMerge,
  GitPullRequestClosed,
  ExternalLink,
  AlertTriangle,
  XCircle,
  Loader2,
  CheckCircle,
} from "lucide-react";

export function PullRequestArtifact({ artifact }: { artifact: Artifact }) {
  const content = artifact.content as PullRequestContent;
  const progress = content.progress;

  const handleOpenPR = () => {
    window.open(content.url, "_blank");
  };

  // Determine status-based styling and content
  const getStatusConfig = () => {
    switch (content.status) {
      case "DONE": // Merged
        return {
          icon: GitMerge,
          iconBgColor: "bg-[#8957e5]/10",
          iconColor: "text-[#8957e5]",
          buttonText: "Merged",
          buttonStyle: { backgroundColor: "#8957e5", color: "white" },
          buttonClassName: "hover:opacity-90",
          borderColor: "border-[#8957e5]/30",
        };
      case "CANCELLED": // Closed
        return {
          icon: GitPullRequestClosed,
          iconBgColor: "bg-[#6e7681]/10",
          iconColor: "text-[#6e7681]",
          buttonText: "Closed",
          buttonStyle: { backgroundColor: "#6e7681", color: "white" },
          buttonClassName: "hover:opacity-90",
          borderColor: "border-[#6e7681]/30",
        };
      case "IN_PROGRESS": // Open
      default:
        return {
          icon: GitPullRequest,
          iconBgColor: "bg-[#238636]/10",
          iconColor: "text-[#238636]",
          buttonText: "Open",
          buttonStyle: { backgroundColor: "#238636", color: "white" },
          buttonClassName: "hover:opacity-90",
          borderColor: "border-[#238636]/30",
        };
    }
  };

  // Get progress indicator config
  const getProgressConfig = () => {
    if (!progress) return null;

    switch (progress.state) {
      case "conflict":
        return {
          icon: AlertTriangle,
          color: "text-amber-500",
          bgColor: "bg-amber-500/10",
          label: "Merge Conflict",
          description: progress.problemDetails || "Has merge conflicts",
        };
      case "ci_failure":
        return {
          icon: XCircle,
          color: "text-red-500",
          bgColor: "bg-red-500/10",
          label: "CI Failed",
          description: progress.ciSummary || progress.problemDetails || "CI checks failed",
        };
      case "checking":
        return {
          icon: Loader2,
          color: "text-blue-500",
          bgColor: "bg-blue-500/10",
          label: "Checking",
          description: "Checking merge status...",
          animate: true,
        };
      case "healthy":
        if (progress.ciStatus === "pending") {
          return {
            icon: Loader2,
            color: "text-blue-500",
            bgColor: "bg-blue-500/10",
            label: "CI Running",
            description: progress.ciSummary || "CI checks in progress",
            animate: true,
          };
        }
        if (progress.ciStatus === "success") {
          return {
            icon: CheckCircle,
            color: "text-green-500",
            bgColor: "bg-green-500/10",
            label: "Ready",
            description: progress.ciSummary || "All checks passed",
          };
        }
        return null;
      default:
        return null;
    }
  };

  // Get resolution status indicator
  const getResolutionConfig = () => {
    if (!progress?.resolution) return null;

    switch (progress.resolution.status) {
      case "in_progress":
        return {
          label: "Agent fixing...",
          color: "text-blue-500",
        };
      case "resolved":
        return {
          label: "Fixed",
          color: "text-green-500",
        };
      case "gave_up":
        return {
          label: "Manual fix needed",
          color: "text-amber-500",
        };
      default:
        return null;
    }
  };

  const config = getStatusConfig();
  const progressConfig = getProgressConfig();
  const resolutionConfig = getResolutionConfig();
  const IconComponent = config.icon;

  return (
    <div className="relative">
      <Card className={`p-4 bg-card rounded-lg border ${config.borderColor}`}>
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <div className={`w-10 h-10 rounded-full ${config.iconBgColor} flex items-center justify-center`}>
              <IconComponent className={`w-5 h-5 ${config.iconColor}`} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground mb-1">Pull Request</div>
            <div className="text-sm text-muted-foreground truncate">{content.repo}</div>
          </div>
          <div className="flex-shrink-0">
            <Button
              onClick={handleOpenPR}
              size="sm"
              className={`gap-2 ${config.buttonClassName}`}
              style={config.buttonStyle}
            >
              {config.buttonText}
              <ExternalLink className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Progress indicator row - hide when merged or closed */}
        {progressConfig && content.status !== "DONE" && content.status !== "CANCELLED" && (
          <div className={`mt-3 pt-3 border-t border-border/50`}>
            <div className="flex items-center gap-2">
              <div className={`p-1 rounded ${progressConfig.bgColor}`}>
                <progressConfig.icon
                  className={`w-4 h-4 ${progressConfig.color} ${progressConfig.animate ? "animate-spin" : ""}`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium ${progressConfig.color}`}>{progressConfig.label}</div>
                <div className="text-xs text-muted-foreground truncate">{progressConfig.description}</div>
              </div>
              {resolutionConfig && (
                <div className={`text-xs font-medium ${resolutionConfig.color}`}>{resolutionConfig.label}</div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
