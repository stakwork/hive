"use client";

import { Artifact, GraphContent } from "@/lib/chat";
import { GraphArtifact } from "@/components/chat/artifacts/GraphArtifact";
import { useParams } from "next/navigation";

interface GraphArtifactPanelProps {
  artifacts: Artifact[];
}

export function GraphArtifactPanel({ artifacts }: GraphArtifactPanelProps) {
  const params = useParams();
  const workspaceSlug = params.slug as string;

  if (artifacts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">No graph available</div>
      </div>
    );
  }

  // Show the most recent graph artifact
  const latestArtifact = artifacts[artifacts.length - 1];

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <GraphArtifact content={latestArtifact.content as GraphContent} workspaceSlug={workspaceSlug} />
    </div>
  );
}
