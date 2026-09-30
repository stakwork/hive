"use client";

import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { strutArtifactReaderUrl } from "@/lib/strut-jobs";
import {
  parseArtifactContent,
  type ArtifactContents,
  type ArtifactKind,
  type ArtifactRef,
  type ArtifactSource,
} from "../../_state/canvasChatArtifacts";
import { useChatOrgLogin } from "./useArtifactPanel";

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

/** Where the reading happens from: the org the conversation belongs to. */
export interface ArtifactLoadContext {
  githubLogin: string;
}

/**
 * Reads the content a ref points at, as it comes — it is parsed afterwards.
 * Only asked about content that lives somewhere else: what an `inline` ref
 * carries is read straight off it. Throws `ArtifactLoadError`.
 */
export type ArtifactLoader = (artifact: ArtifactRef, context: ArtifactLoadContext) => Promise<unknown>;

/** The file's name, for a `code` ref's highlighting. */
const basename = (key: string): string => key.split("/").pop() ?? key;

/**
 * A `graph` ref: something on a swarm's strut — a file in a job's
 * directory or in a run's artifacts (`key` is strut's own link) — read
 * through Hive's reader route, which checks the ref against Hive's rows
 * before asking the swarm and serves the bytes from Hive's own origin
 * (`api/orgs/[githubLogin]/strut/artifacts`). What comes back depends on
 * the kind: text kinds are fetched and shaped here; media, a PDF and a
 * page are handed to their viewers as an address on this origin.
 */
export async function readStrutArtifact(
  artifact: ArtifactRef,
  context: ArtifactLoadContext,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const { kind, source } = artifact;
  if (source.type !== "graph") throw new ArtifactLoadError("unavailable");
  const url = strutArtifactReaderUrl(context.githubLogin, source.swarmId, source.key);
  switch (kind) {
    case "image":
    case "video":
    case "audio":
    case "pdf":
    case "url":
      return { url };
    case "markdown":
    case "log":
    case "code":
    case "json":
      break;
    default:
      // A stored page, a diff's files, a pull request: not something bytes on a swarm are.
      throw new ArtifactLoadError("unavailable");
  }
  let res: Response;
  try {
    res = await fetchImpl(url, { credentials: "same-origin" });
  } catch {
    throw new ArtifactLoadError("failed");
  }
  if (res.status === 401 || res.status === 403) throw new ArtifactLoadError("denied");
  if (res.status === 404) throw new ArtifactLoadError("unavailable");
  if (!res.ok) throw new ArtifactLoadError("failed");
  const text = await res.text();
  switch (kind) {
    case "markdown":
    case "log":
      return { text };
    case "code":
      return { code: text, filename: basename(source.key) };
    case "json":
      try {
        return { value: JSON.parse(text) };
      } catch {
        throw new ArtifactLoadError("unavailable");
      }
  }
}

/** The loader the app runs on: `graph` refs through the strut reader; nothing else lives anywhere yet. */
const loadArtifactContent: ArtifactLoader = (artifact, context) => readStrutArtifact(artifact, context);

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
  const githubLogin = useChatOrgLogin();
  const { kind, source } = artifact;

  // Content on the ref needs no round trip, and so no loading state.
  const inline = useMemo(
    () => (source.type === "inline" ? parseArtifactContent(kind, source.content) : null),
    [kind, source],
  );

  const query = useQuery({
    queryKey: ["canvas-artifact", kind, sourceKey(source), githubLogin],
    queryFn: async () => {
      const content = parseArtifactContent(kind, await load(artifact, { githubLogin }));
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
