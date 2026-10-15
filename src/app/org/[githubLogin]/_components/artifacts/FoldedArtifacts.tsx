"use client";

import React, { useState } from "react";
import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { artifactIdentity, type ArtifactContents, type ArtifactRef } from "../../_state/canvasChatArtifacts";
import { plural } from "./lines";
import { artifactKind } from "./registry";
import { useArtifactContent } from "./useArtifactContent";

/**
 * A message's artifacts that ask nothing of the reader, as one quiet line
 * under it: each name opens that artifact on the panel, the count opens the
 * panel's index of everything in the chat. The ones that do ask stay cards
 * (`artifactAsks`). With `thumbnails`, its images show small under the line.
 */
export const FoldedArtifacts = React.memo(
  function FoldedArtifacts({
    artifacts,
    afterCards,
    thumbnails = false,
  }: {
    artifacts: ArtifactRef[];
    /** Cards sit above, so this line reads as "N more". */
    afterCards: boolean;
    /** Show the images small under the line (`lastThumbnailSet`). */
    thumbnails?: boolean;
  }) {
    const onPanel = useCanvasChatStore((s) => s.artifactPanel?.identity ?? null);
    const { openArtifactPanel, openArtifactIndex } = useCanvasChatStore.getState();
    const count = artifacts.length;
    const images = thumbnails ? artifacts.filter((artifact) => artifact.kind === "image") : [];

    return (
      <div data-testid="folded-artifacts" className="space-y-1.5">
        <div className="flex min-w-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Layers aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <button
            type="button"
            onClick={openArtifactIndex}
            className="shrink-0 transition-colors hover:text-foreground"
          >
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
        {images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {images.map((artifact) => {
              const identity = artifactIdentity(artifact);
              return <ImageThumbnail key={identity} artifact={artifact} onPanel={onPanel === identity} />;
            })}
          </div>
        )}
      </div>
    );
  },
  // The chat re-renders on every streamed chunk and hands over a fresh array each time: the same refs are no change.
  (prev, next) =>
    prev.afterCards === next.afterCards &&
    prev.thumbnails === next.thumbnails &&
    prev.artifacts.length === next.artifacts.length &&
    prev.artifacts.every((artifact, i) => artifact === next.artifacts[i]),
);

/**
 * An image, small, opening it on the panel. Loading it here is what makes
 * the panel instant: the panel asks for the same address, and the browser
 * hands back the image it already has despite the reader's `no-store`.
 */
function ImageThumbnail({ artifact, onPanel }: { artifact: ArtifactRef; onPanel: boolean }) {
  const state = useArtifactContent(artifact);
  const [failed, setFailed] = useState(false);
  if (state.status !== "ready" || failed) return null;
  const { url, alt } = state.content as ArtifactContents["image"];
  return (
    <button
      type="button"
      title={artifact.title}
      onClick={() => useCanvasChatStore.getState().openArtifactPanel(artifactIdentity(artifact))}
      aria-pressed={onPanel}
      className={cn(
        "h-14 w-24 shrink-0 overflow-hidden rounded border bg-muted/30 transition-colors hover:border-foreground/30",
        onPanel && "border-foreground/30",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt ?? artifact.title}
        draggable={false}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover object-top"
      />
    </button>
  );
}

/**
 * The message whose folded artifacts show their images small: the newest
 * one carrying an image. Nothing later reports those images again, so they
 * are folded under it (`indexArtifactCards`); an image never asks, so it is
 * never a card. Null when no message carries one.
 */
export function lastThumbnailSet(messages: ReadonlyArray<{ id: string; artifacts?: ArtifactRef[] }>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].artifacts?.some((artifact) => artifact.kind === "image")) return messages[i].id;
  }
  return null;
}
