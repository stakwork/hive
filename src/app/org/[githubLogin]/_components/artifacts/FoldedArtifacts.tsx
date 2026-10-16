"use client";

import React from "react";
import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { artifactIdentity, type ArtifactRef } from "../../_state/canvasChatArtifacts";
import { plural } from "./lines";
import { artifactKind } from "./registry";

/**
 * A message's reference material — the kinds with no place in the chat
 * (`chat` in `artifacts/registry.ts`: logs, JSON, code, diffs, graph
 * traces) — as one quiet line under it: each name opens that artifact on
 * the panel, the count opens the panel's index of everything in the chat.
 */
export const FoldedArtifacts = React.memo(function FoldedArtifacts({
  artifacts,
  afterOthers,
}: {
  artifacts: ArtifactRef[];
  /** Other artifacts show above it, so this line reads as "N more". */
  afterOthers: boolean;
}) {
  const onPanel = useCanvasChatStore((s) => s.artifactPanel?.identity ?? null);
  const { openArtifactPanel, openArtifactIndex } = useCanvasChatStore.getState();
  const count = artifacts.length;

  return (
    <div
      data-testid="folded-artifacts"
      className="flex min-w-0 items-center gap-1.5 px-1 text-xs text-muted-foreground"
    >
      <Layers aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <button type="button" onClick={openArtifactIndex} className="shrink-0 transition-colors hover:text-foreground">
        {afterOthers ? `${count} more` : plural(count, "artifact")}
      </button>
      <span aria-hidden>·</span>
      <span className="min-w-0 truncate">
        {artifacts.map((artifact, i) => {
          const identity = artifactIdentity(artifact);
          return (
            <React.Fragment key={identity}>
              {i > 0 && ", "}
              <button
                type="button"
                title={artifact.title}
                onClick={() => openArtifactPanel(identity)}
                aria-pressed={onPanel === identity}
                className={cn("transition-colors hover:text-foreground", onPanel === identity && "text-foreground")}
              >
                {artifact.label ?? artifactKind(artifact.kind).label}
              </button>
            </React.Fragment>
          );
        })}
      </span>
    </div>
  );
});
