"use client";

import React from "react";
import type { ArtifactContents, ArtifactViewerProps, TraceLink, TraceOrigin } from "../../../_state/canvasChatArtifacts";
import { ScrollFade } from "../chrome";
import { plural } from "../lines";

/** "3 exact · 2 inferred", for the preview's caption. */
export function traceFact(content: ArtifactContents["trace"]): string | null {
  const exact = content.upstream.filter((link) => link.match === "exact").length;
  const inferred = content.upstream.length - exact;
  if (content.upstream.length === 0) return null;
  return inferred === 0 ? `${plural(exact, "exact link")}` : `${plural(exact, "exact link")} · ${plural(inferred, "inferred link")}`;
}

function originLabel(origin: TraceOrigin): string {
  return origin.kind === "strut" && origin.run ? `strut run ${origin.run}` : "this reply";
}

function MatchBadge({ match }: { match: TraceLink["match"] }) {
  return (
    <span
      className={
        match === "exact"
          ? "rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
          : "rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
      }
    >
      {match === "exact" ? "Exact" : "Inferred"}
    </span>
  );
}

function LinkRow({ link }: { link: TraceLink }) {
  return (
    <li className="rounded-md border border-border/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-foreground">{link.toolName}</span>
        <MatchBadge match={link.match} />
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground">{link.excerpt}</p>
      {link.nodes && link.nodes.length > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          touched {plural(link.nodes.length, "node")}: {link.nodes.map((node) => node.ref_id).join(", ")}
        </p>
      )}
    </li>
  );
}

/** The chat preview: where the selection came from, and the exact/inferred tally. */
export function TracePreview({ content }: ArtifactViewerProps<"trace">) {
  const fact = traceFact(content);
  return (
    <span className="block space-y-0.5 text-xs text-muted-foreground">
      <span className="block truncate">
        Where <span className="rounded bg-muted px-1 font-mono text-foreground">{content.selection}</span> came from in{" "}
        {originLabel(content.origin)}
      </span>
      {fact && <span className="block truncate">{fact}</span>}
    </span>
  );
}

/**
 * The full chain: the selection itself, the links back to its sources
 * (oldest last — closest producer first), and, when it came from a middle
 * step, the later steps that used it.
 */
export function TracePanel({ content }: ArtifactViewerProps<"trace">) {
  return (
    <ScrollFade className="mx-auto w-full max-w-3xl px-8 py-8">
      <div className="space-y-6">
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Selection</h3>
          <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-sm">
            {content.selection}
          </p>
        </section>

        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Where it came from {content.upstream.length === 0 && "— no source found"}
          </h3>
          {content.upstream.length > 0 && (
            <ul className="mt-2 space-y-2">
              {content.upstream.map((link, i) => (
                <LinkRow key={link.toolCallId ?? link.path ?? i} link={link} />
              ))}
            </ul>
          )}
        </section>

        {content.downstream.length > 0 && (
          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Later steps that used it</h3>
            <ul className="mt-2 space-y-2">
              {content.downstream.map((link, i) => (
                <LinkRow key={link.toolCallId ?? link.path ?? i} link={link} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </ScrollFade>
  );
}
