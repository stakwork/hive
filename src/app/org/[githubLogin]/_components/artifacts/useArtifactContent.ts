"use client";

import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  parseArtifactContent,
  type ArtifactContents,
  type ArtifactKind,
  type ArtifactRef,
  type ArtifactSource,
} from "../../_state/canvasChatArtifacts";

/**
 * From a ref to its content. A message only says where an artifact's
 * content lives; this is the one place that goes and reads it. The card
 * and the panel both come through here, so an artifact open on the panel
 * and previewed in the chat is read once.
 */

/** Why content could not be read. Only `failed` is worth another try. */
export type ArtifactLoadFailure = "unavailable" | "denied" | "failed";

export class ArtifactLoadError extends Error {
  constructor(readonly reason: ArtifactLoadFailure) {
    super(`Artifact ${reason}`);
    this.name = "ArtifactLoadError";
  }
}

/**
 * Reads the content a ref points at, as it comes — it is parsed afterwards.
 * Only asked about content that lives somewhere else: what an `inline` ref
 * carries is read straight off it. Throws `ArtifactLoadError`.
 */
export type ArtifactLoader = (artifact: ArtifactRef) => Promise<unknown>;

/**
 * The loader the app runs on. Nothing reads a `graph` pointer yet: that
 * reader — a Hive route that checks the ref against Hive's own rows before
 * asking the swarm — plugs in here.
 */
const loadArtifactContent: ArtifactLoader = async () => {
  throw new ArtifactLoadError("unavailable");
};

/** The loader in force. Only something that stands in for the real readers — a demo, a test — provides another. */
export const ArtifactLoaderContext = createContext<ArtifactLoader>(loadArtifactContent);

export type ArtifactContentState =
  | { status: "loading" }
  | { status: "ready"; content: ArtifactContents[ArtifactKind] }
  | { status: "unavailable" | "denied" }
  | { status: "failed"; retry: () => void };

/** What makes two reads the same read: inline content is never fetched, so it needs no key of its own. */
const sourceKey = (source: ArtifactSource): string =>
  source.type === "graph" ? `${source.swarmId}:${source.key}` : source.type;

const failureOf = (error: unknown): ArtifactLoadFailure =>
  error instanceof ArtifactLoadError ? error.reason : "failed";

/**
 * An artifact's content. `enabled` holds the read back until someone is
 * looking — a card that has not scrolled into view yet.
 */
export function useArtifactContent(artifact: ArtifactRef, enabled = true): ArtifactContentState {
  const load = useContext(ArtifactLoaderContext);
  const { kind, source } = artifact;

  // Content on the ref needs no round trip, and so no loading state.
  const inline = useMemo(
    () => (source.type === "inline" ? parseArtifactContent(kind, source.content) : null),
    [kind, source],
  );

  const query = useQuery({
    queryKey: ["canvas-artifact", kind, sourceKey(source)],
    queryFn: async () => {
      const content = parseArtifactContent(kind, await load(artifact));
      if (!content) throw new ArtifactLoadError("unavailable");
      return content;
    },
    enabled: enabled && source.type !== "inline",
    // Gone and forbidden stay that way; anything else gets one more go, and after that it is the reader's call.
    retry: (failures, error) => failures < 1 && failureOf(error) === "failed",
    retryOnMount: false,
  });

  if (source.type === "inline") return inline ? { status: "ready", content: inline } : { status: "unavailable" };
  if (query.data) return { status: "ready", content: query.data };
  if (query.error) {
    const reason = failureOf(query.error);
    return reason === "failed" ? { status: "failed", retry: () => void query.refetch() } : { status: reason };
  }
  return { status: "loading" };
}
