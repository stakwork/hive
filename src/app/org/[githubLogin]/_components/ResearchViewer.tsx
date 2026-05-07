"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { useCanvasChatStore } from "../_state/canvasChatStore";

/**
 * Anthropic's `webSearch` provider tool returns each search-call's
 * results as an array of `{ url, title, ... }`. The agent then writes
 * markdown that cites those results inline as `<cite index="N-M">text</cite>`,
 * where `N` is 1-indexed into a flat list of all results from every
 * `web_search` call in the conversation, in the order they happened.
 *
 * We can't change Claude's citation behavior via prompting (we tried;
 * it ignored the instruction). So we convert client-side: walk the
 * conversation's `web_search` tool outputs in order, flatten into a
 * single array, and replace `<cite>` tags with markdown links.
 *
 * If a citation index is out of range (e.g. the user refreshed and
 * `web_search` outputs aren't in the store anymore), we drop the
 * `<cite>` tag and keep its inner text \u2014 the doc is still readable,
 * just without inline links. Same fallback for content rendered
 * outside the original session.
 */
interface SearchResult {
  url: string;
  title?: string;
}

function flattenWebSearchResults(
  messages: Array<{ toolCalls?: Array<{ toolName: string; output?: unknown }> }>,
): SearchResult[] {
  const out: SearchResult[] = [];
  for (const msg of messages) {
    if (!msg.toolCalls?.length) continue;
    for (const tc of msg.toolCalls) {
      if (tc.toolName !== "web_search") continue;
      // Anthropic's webSearch returns the array directly as the
      // tool output. Be defensive: empty/string/object outputs
      // (errors, mocks) just contribute nothing.
      if (!Array.isArray(tc.output)) continue;
      for (const r of tc.output) {
        if (
          r &&
          typeof r === "object" &&
          typeof (r as { url?: unknown }).url === "string"
        ) {
          out.push({
            url: (r as SearchResult).url,
            title: (r as SearchResult).title,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Module-level empty sentinel for the Zustand selector's no-active-
 * conversation fallback. Returning a fresh `[]` from the selector
 * would defeat `Object.is` and re-fire the citation memo on every
 * store mutation.
 */
const EMPTY_MESSAGES: never[] = [];

function applyCitationLinks(
  text: string,
  results: SearchResult[],
): string {
  return text.replace(
    /<cite index="(\d+)-\d+">(.*?)<\/cite>/g,
    (_match, indexStr: string, anchor: string) => {
      const idx = parseInt(indexStr, 10) - 1;
      const r = results[idx];
      // Out-of-range or missing results \u2014 strip the tag, keep the
      // anchor text. Doc stays readable; that span just isn't a link.
      if (!r) return anchor;
      // Markdown link syntax. Anchor text comes from the model so it
      // can theoretically contain `]` which would break markdown
      // parsing; rare enough in practice that we don't escape, but
      // worth knowing if a citation ever renders weird.
      return `[${anchor}](${r.url})`;
    },
  );
}

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

  // Pull web_search results from the active conversation (if any) so
  // we can convert `<cite index="N-N">...</cite>` tags into clickable
  // markdown links. Selecting just the `messages` array of the
  // active conversation keeps re-renders cheap; outside this viewer,
  // nothing else cares about that selector.
  //
  // No active conversation (refresh, fork, or just dashboard chat)
  // \u2192 results are empty \u2192 `applyCitationLinks` strips tags down to
  // anchor text, doc stays readable.
  const activeMessages = useCanvasChatStore((s) => {
    const id = s.activeConversationId;
    if (!id) return EMPTY_MESSAGES;
    return s.conversations[id]?.messages ?? EMPTY_MESSAGES;
  });
  const renderedContent = useMemo(() => {
    if (content === null) return null;
    const results = flattenWebSearchResults(activeMessages);
    return applyCitationLinks(content, results);
  }, [content, activeMessages]);

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
            <ReactMarkdown>{renderedContent ?? ""}</ReactMarkdown>
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
