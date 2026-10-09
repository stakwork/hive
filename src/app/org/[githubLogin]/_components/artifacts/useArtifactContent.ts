"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { strutArtifactReaderUrl } from "@/lib/strut-jobs";
import { getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { usePusherChannel } from "@/hooks/usePusherChannel";
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
 * the kind: text kinds are fetched and shaped here; media and a PDF are
 * handed to their viewers as an address on this origin; a page as where it
 * is on the swarm, which `HtmlArtifactFrame` reads through the same reader
 * and renders from a blob in a sandboxed frame — never by navigating to it.
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
    case "html":
      return { swarmId: source.swarmId, key: source.key };
    case "markdown":
    case "log":
    case "code":
    case "json":
      break;
    default:
      // A diff's files, a pull request, a graph: not something bytes on a swarm are.
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

/** Repo and number named by an inline pull_request ref, used for both the fetch URL and the live-nudge match. */
interface PrLiveTarget {
  url: string;
  repo: string;
  number: number;
}

/**
 * Where a pull request's live state is read from: Hive's route, which asks
 * GitHub with the viewer's own token
 * (`api/orgs/[githubLogin]/strut/pull-request`). Null when the ref does not
 * name a pull request by repo and number.
 */
function prLiveTarget(githubLogin: string, inline: Record<string, unknown>): PrLiveTarget | null {
  const { repo, number } = inline;
  if (typeof repo !== "string" || !repo || typeof number !== "number" || !Number.isInteger(number)) return null;
  const sp = new URLSearchParams({ repo, number: String(number) });
  return { url: `/api/orgs/${encodeURIComponent(githubLogin)}/strut/pull-request?${sp}`, repo, number };
}

/** Query key the card and the panel share — one poll, one live-nudge target, serves both. */
const prLiveQueryKey = (githubLogin: string, repo: string, number: number) =>
  ["canvas-pr-live", githubLogin, repo, number] as const;

/** Whether a PR state is terminal — no more polling needed. */
const isTerminalPrState = (state: unknown): boolean =>
  state === "merged" || state === "closed";

const PR_LIVE_POLL_MS = 30_000;

/**
 * How long until the live read goes again, or `false` for never: once the
 * PR is merged or closed there is nothing left to learn, and once a read has
 * failed — the viewer has no GitHub token for the repo's owner, or GitHub
 * will not show them the PR — asking again every half minute would not
 * change the answer. The inline state stands; a window focus or a reconnect
 * still retries once, and a read that succeeds then resumes the interval.
 */
export const prLivePollInterval = (state: { status: string; data?: Record<string, unknown> }): number | false =>
  state.status === "error" || isTerminalPrState(state.data?.state) ? false : PR_LIVE_POLL_MS;

/**
 * An artifact's content. `enabled` holds the read back until someone is
 * looking — a card that has not scrolled into view yet.
 */
export function useArtifactContent(artifact: ArtifactRef, enabled = true): ArtifactContentState {
  const load = useContext(ArtifactLoaderContext);
  const githubLogin = useChatOrgLogin();
  const queryClient = useQueryClient();
  const { kind, source } = artifact;

  // Content on the ref needs no round trip, and so no loading state.
  const inline = useMemo(
    () => (source.type === "inline" ? parseArtifactContent(kind, source.content) : null),
    [kind, source],
  );

  // ── Live PR status polling (an inline pull_request, by repo and number) ──
  //
  // The inline content is the first paint — the state the job reported —
  // and this query overlays the live state once it arrives, read from
  // GitHub with the viewer's own token. The card and the panel share the
  // same query key so a single poll serves both. Polling stops once the PR
  // is merged or closed, or once a read has failed (`prLivePollInterval`),
  // and does not run when the tab is hidden.
  const prTarget = useMemo(
    () =>
      kind === "pull_request" && source.type === "inline"
        ? prLiveTarget(githubLogin, source.content)
        : null,
    [kind, source, githubLogin],
  );

  const prLiveQuery = useQuery({
    queryKey: prTarget
      ? prLiveQueryKey(githubLogin, prTarget.repo, prTarget.number)
      : (["canvas-pr-live", githubLogin, null, null] as const),
    queryFn: async () => {
      const res = await fetch(prTarget!.url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`pr-live ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    },
    enabled: enabled && prTarget !== null,
    refetchInterval: (query) => prLivePollInterval(query.state),
    refetchIntervalInBackground: false,
    // On network errors keep the inline state — don't surface as "failed".
    retry: false,
  });

  // ── Live PR nudge (webhook-driven) ──────────────────────────────────────
  //
  // The 30s poll above is the backup; this is what makes a merge/close/
  // reopen/check update show up immediately. The webhook carries NO pull
  // request data — just `{ repo, number }` — so every open viewer refetches
  // through its own route/token (same request the poll already makes). The
  // org channel is already subscribed to elsewhere on the canvas page
  // (`usePusherChannel` is refcounted), so this adds no extra connection.
  const prChannel = usePusherChannel(prTarget ? getOrgChannelName(githubLogin) : null);
  useEffect(() => {
    if (!prChannel || !prTarget) return;
    const handler = (payload: { repo?: string; number?: number }) => {
      // GitHub's `full_name` casing (the webhook's `repo`) may not match
      // the ref's own casing — compare case-insensitively.
      if (payload.repo?.toLowerCase() !== prTarget.repo.toLowerCase() || payload.number !== prTarget.number) return;
      void queryClient.invalidateQueries({ queryKey: prLiveQueryKey(githubLogin, prTarget.repo, prTarget.number) });
    };
    prChannel.bind(PUSHER_EVENTS.CANVAS_PR_UPDATED, handler);
    return () => {
      prChannel.unbind(PUSHER_EVENTS.CANVAS_PR_UPDATED, handler);
    };
  }, [prChannel, prTarget, githubLogin, queryClient]);

  // Overlay the live result on the inline content for pull_request refs.
  const liveOverlaidContent = useMemo(() => {
    if (kind !== "pull_request" || !inline) return null;
    const live = prLiveQuery.data;
    if (!live) return inline;
    // Merge live fields onto the inline content and re-parse so the type
    // checker validates the merged object.
    return parseArtifactContent(kind, { ...(source.type === "inline" ? source.content : {}), ...live });
  }, [kind, inline, prLiveQuery.data, source]);

  // ── Regular graph-source query ────────────────────────────────────────
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

  // ── Result ────────────────────────────────────────────────────────────
  if (source.type === "inline") {
    // pull_request with live overlay (or inline fallback when overlay is loading/errored).
    if (kind === "pull_request") {
      const content = liveOverlaidContent ?? inline;
      return content ? { status: "ready", content } : { status: "unavailable" };
    }
    return inline ? { status: "ready", content: inline } : { status: "unavailable" };
  }
  if (query.data) return { status: "ready", content: query.data };
  if (query.error) {
    const reason = failureOf(query.error);
    return reason === "failed" ? { status: "failed", retry: () => void query.refetch() } : { status: reason };
  }
  return { status: "loading" };
}
