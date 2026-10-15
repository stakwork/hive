"use client";

import React from "react";
import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { artifactIdentity, type ArtifactRef } from "../../_state/canvasChatArtifacts";
import { plural } from "./lines";
import { artifactKind } from "./registry";

/**
 * A message's artifacts that ask nothing of the reader, as one quiet line
 * under it: each name opens that artifact on the panel, the count opens the
 * panel's index of everything in the chat. The ones that do ask stay cards
 * (`artifactAsks`).
 */
export const FoldedArtifacts = React.memo(
  function FoldedArtifacts({
    artifacts,
    afterCards,
  }: {
    artifacts: ArtifactRef[];
    /** Cards sit above, so this line reads as "N more". */
    afterCards: boolean;
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
          {afterCards ? `${count} more` : plural(count, "artifact")}
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
  },
  // The chat re-renders on every streamed chunk and hands over a fresh array each time: the same refs are no change.
  (prev, next) =>
    prev.afterCards === next.afterCards &&
    prev.artifacts.length === next.artifacts.length &&
    prev.artifacts.every((artifact, i) => artifact === next.artifacts[i]),
);
