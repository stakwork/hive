"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Artifact, PullRequestContent } from "@/lib/chat";
import { GitPullRequest, ExternalLink } from "lucide-react";

export function PullRequestArtifact({ artifact }: { artifact: Artifact }) {
  const content = artifact.content as PullRequestContent;

  const handleMerge = () => {
    window.open(content.url, "_blank");
  };

  return (
    <div className="relative">
      <Card className="p-4 bg-card rounded-lg border border-primary/30">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <GitPullRequest className="w-5 h-5 text-primary" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground mb-1">Pull Request</div>
            <div className="text-sm text-muted-foreground truncate">{content.repo}</div>
          </div>
          <div className="flex-shrink-0">
            <Button onClick={handleMerge} size="sm" className="gap-2">
              Merge PR
              <ExternalLink className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
