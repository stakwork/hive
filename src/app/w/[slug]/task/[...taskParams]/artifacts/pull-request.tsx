"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Artifact, PullRequestContent } from "@/lib/chat";
import { GitPullRequest, GitMerge, GitPullRequestClosed, ExternalLink } from "lucide-react";

export function PullRequestArtifact({ artifact }: { artifact: Artifact }) {
  const content = artifact.content as PullRequestContent;

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

  const config = getStatusConfig();
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
      </Card>
    </div>
  );
}
