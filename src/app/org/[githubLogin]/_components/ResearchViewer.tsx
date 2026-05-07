"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { usePusherChannel } from "@/hooks/usePusherChannel";

/**
 * Right-panel viewer for a Research node.
 *
 * Mirrors `ConnectionViewer` in spirit (header + scrollable body) but
 * is intentionally simpler: a Research doc is a single markdown
 * blob, not a structured set of sections. The on-canvas card label
 * (the user's `topic`) is shown as a small kicker above the polished
 * `title`; the `summary` sits between title and the markdown body.
 *
 * Two visual states:
 *   - **researching** (`content` is null) — spinner with
 *     "Researching…" text where the markdown will go. The agent is
 *     running web_search and writing the doc.
 *   - **ready** (`content` is non-null) — the markdown renders.
 *
 * Live updates: subscribes to the org Pusher channel and refetches
 * the row when `RESEARCH_UPDATED` lands for this slug. `update_research`
 * fires that event with `fields: ["content"]` so a viewer that opened
 * during the research phase swaps the spinner for markdown without
 * needing a manual refresh.
 *
 * Mounted from `NodeDetail.tsx` `case "research":`. The parent (the
 * Details tab) owns the load — fetches the row from
 * `/api/orgs/[githubLogin]/canvas/node/research:<id>` and passes the
 * relevant fields here. We re-fetch on Pusher events because the
 * parent's fetch ran once per node selection and won't notice a
 * mid-flight content fill.
 */

interface ResearchViewerProps {
  /** Research row id (without the `research:` prefix). */
  id: string;
  /** Slug — used to match Pusher events to this viewer. */
  slug: string;
  /** Polished title for the header. */
  title: string;
  /** The user's original wording, shown as a small kicker above the title. */
  topic: string;
  /** One-sentence overview shown above the markdown. */
  summary: string;
  /** Markdown body. `null` means the agent hasn't called update_research yet. */
  content: string | null;
  /** Org login — used for Pusher channel name and re-fetch URL. */
  githubLogin: string;
}

export function ResearchViewer({
  id,
  slug,
  title,
  topic,
  summary,
  content: initialContent,
  githubLogin,
}: ResearchViewerProps) {
  // Local mirror of `content` so Pusher updates can fill it in
  // without forcing a parent re-render. `initialContent` resets it
  // when the user switches to a different research node.
  const [content, setContent] = useState<string | null>(initialContent);
  useEffect(() => {
    setContent(initialContent);
  }, [initialContent, id]);

  // Subscribe to the org's RESEARCH_UPDATED stream and refetch
  // whenever this slug's content gets filled in. `usePusherChannel`
  // is refcounted, so multiple consumers (canvas, connection viewer,
  // research viewer) sharing the same org channel don't fight each
  // other on subscribe/unsubscribe.
  const channel = usePusherChannel(getOrgChannelName(githubLogin));
  useEffect(() => {
    if (!channel) return;
    const handler = (payload: {
      slug?: string;
      action?: string;
      fields?: string[];
    }) => {
      if (payload.slug !== slug) return;
      if (payload.action !== "updated") return;
      // Refetch the row's content. We only care about the `content`
      // field; everything else (title/summary/topic) is immutable
      // post-creation. The endpoint is the same one the Details tab
      // hits on click, so we get caching for free.
      fetch(
        `/api/orgs/${githubLogin}/canvas/node/${encodeURIComponent("research:" + id)}`,
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { description?: string | null } | null) => {
          if (body?.description !== undefined) setContent(body.description);
        })
        .catch(() => {
          // Non-fatal: viewer just stays on its current state until
          // the user clicks away and back. Network blips happen.
        });
    };
    channel.bind(PUSHER_EVENTS.RESEARCH_UPDATED, handler);
    return () => {
      channel.unbind(PUSHER_EVENTS.RESEARCH_UPDATED, handler);
    };
  }, [channel, githubLogin, id, slug]);

  const isResearching = content === null;

  return (
    <div className="space-y-4">
      {/* Kicker: the user's original topic, shown above the polished
          title so the user can see "this is the research I asked for
          using these words" even when the agent's title is reworded. */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          <Search className="h-3 w-3" />
          <span>Topic</span>
        </div>
        <p className="text-sm text-muted-foreground italic">{topic}</p>
      </div>

      {/* Summary — always present (set by save_research). Shown above
          the markdown body so the user has a one-sentence framing
          even while the full content is still being written. */}
      {summary && (
        <div className="text-sm leading-relaxed">{summary}</div>
      )}

      {/* Body: markdown when ready, spinner placeholder while
          researching. Same visual language as ConnectionViewer's
          per-section pending spinners. */}
      <div className="border-t pt-4">
        {isResearching ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Researching…</span>
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>

      {/* Title rendered subtly at the bottom — the panel header
          (NodeDetail's outer chrome) already shows it prominently
          via `node.text`/`detail.name`, so we don't need to repeat
          it loudly. Only show it if it differs from the topic so we
          don't render the same string twice when the agent didn't
          rewrite it. */}
      {title && title !== topic && (
        <div className="border-t pt-3 text-xs text-muted-foreground">
          <span className="uppercase tracking-wider mr-1">Title</span>
          <span>{title}</span>
        </div>
      )}
    </div>
  );
}
