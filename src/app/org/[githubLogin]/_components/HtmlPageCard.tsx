"use client";

import React from "react";
import { Check, ExternalLink, FileCode2, Loader2, XCircle } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { HtmlArtifactFrame } from "@/components/html-artifact/HtmlArtifactFrame";
import type { CanvasChatMessage } from "../_state/canvasChatStore";

export interface HtmlPageRun {
  slug: string;
  title: string;
  /** Org-member share path, e.g. `/org/{githubLogin}/h/{slug}`. */
  sharePath: string;
  /** "saving" while in flight, "ready" on success, "failed" on failure */
  status: "saving" | "ready" | "failed";
  /** Human-readable failure reason, when the tool returned one. */
  error?: string;
  anchorMessageId: string;
  /**
   * ISO timestamp from a successful `update_html`. Passed through to
   * `HtmlArtifactFrame` so a patch re-fetches fresh bytes instead of
   * keeping the blob from the original `save_html`.
   */
  updatedAt?: string;
}

function buildSharePath(githubLogin: string, slug: string): string {
  return `/org/${githubLogin}/h/${slug}`;
}

/**
 * Walk all canvas chat messages and group `save_html` / `update_html`
 * tool calls by slug.
 *
 * Convention mirrors `getResearchRunsFromMessages`:
 * - Derivation is from the message *timeline* (`toolCalls` + their
 *   `output`), never from `state.artifacts` — canvas artifacts are not
 *   persisted by autosave, so a reloaded / shared / live-synced
 *   conversation would lose the card.
 * - The most recent call for a slug wins the anchor position, so an
 *   `update_html` moves the card down to the latest exchange.
 */
export function getHtmlPagesFromMessages(
  messages: CanvasChatMessage[],
  githubLogin: string,
): HtmlPageRun[] {
  const bySlug = new Map<string, HtmlPageRun>();

  messages.forEach((message) => {
    if (!message.toolCalls?.length) return;
    for (const tc of message.toolCalls) {
      if (tc.toolName !== "save_html" && tc.toolName !== "update_html") continue;

      const input = (tc.input ?? {}) as { slug?: string; title?: string };
      const output = (tc.output ?? {}) as {
        slug?: string;
        id?: string;
        sharePath?: string;
        status?: string;
        error?: string;
        updatedAt?: string;
      };

      const slug = output.slug ?? input.slug;
      if (!slug) continue;

      const previous = bySlug.get(slug);
      const errorText = output.error ?? tc.errorText;
      const status: HtmlPageRun["status"] = errorText
        ? "failed"
        : output.slug
          ? "ready"
          : "saving";

      bySlug.set(slug, {
        slug,
        // `update_html` carries no title — keep the one the original
        // `save_html` established, falling back to the slug.
        title: input.title ?? previous?.title ?? slug,
        sharePath:
          output.sharePath ??
          previous?.sharePath ??
          buildSharePath(githubLogin, slug),
        status,
        error: errorText,
        anchorMessageId: message.id,
        updatedAt: output.updatedAt ?? previous?.updatedAt,
      });
    }
  });

  return Array.from(bySlug.values()).filter((p) => p.anchorMessageId);
}

// ── Status pill helpers ──────────────────────────────────────────────────────

const TONE_PILL_CLASSES: Record<HtmlPageRun["status"], string> = {
  saving:
    "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-1 ring-inset ring-sky-500/20",
  ready:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20",
  failed:
    "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20",
};

function StatusPill({ status }: { status: HtmlPageRun["status"] }) {
  const label =
    status === "saving"
      ? "Saving\u2026"
      : status === "ready"
        ? "Ready"
        : "Failed";
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${TONE_PILL_CLASSES[status]}`}
    >
      {status === "saving" && (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      )}
      {status === "ready" && <Check className="h-3 w-3" aria-hidden="true" />}
      {status === "failed" && <XCircle className="h-3 w-3" aria-hidden="true" />}
      {label}
    </span>
  );
}

// ── Share URL row ────────────────────────────────────────────────────────────

/**
 * Absolute share URL plus the shared `CopyButton` (the same icon-only
 * copy affordance used by the agent-logs detail panel) — no bespoke
 * clipboard handling here.
 */
function ShareUrlRow({ sharePath }: { sharePath: string }) {
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${sharePath}`
      : sharePath;

  return (
    <div className="mt-1.5 flex items-center gap-1">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 text-[10px] text-muted-foreground">
        {shareUrl}
      </code>
      <CopyButton value={shareUrl} />
    </div>
  );
}

// ── HtmlPageCard ─────────────────────────────────────────────────────────────

export function HtmlPageCard({
  page,
  githubLogin,
}: {
  page: HtmlPageRun;
  githubLogin: string;
}) {
  return (
    <div
      data-html-page-slug={page.slug}
      className="rounded-lg border bg-card px-3 py-2.5 text-card-foreground"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex-shrink-0">
          <FileCode2
            className="h-3.5 w-3.5 text-sky-500"
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="font-medium">HTML page</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-sm font-medium">
            <span className="min-w-0 truncate">{page.title}</span>
            {page.status === "ready" && (
              <a
                href={page.sharePath}
                target="_blank"
                rel="noreferrer"
                className="inline-flex flex-shrink-0 items-center text-muted-foreground hover:text-foreground"
                title="Open page"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {page.status === "ready" ? (
            <>
              <div className="mt-1.5 h-64 overflow-hidden rounded-md border bg-background">
                <HtmlArtifactFrame
                  source={{ githubLogin, slug: page.slug }}
                  title={page.title}
                  updatedAt={page.updatedAt}
                  className="h-full w-full"
                />
              </div>
              <ShareUrlRow sharePath={page.sharePath} />
            </>
          ) : (
            <div className="mt-1.5 flex h-24 items-center justify-center rounded-md border border-dashed bg-muted/20 px-3 text-center text-xs text-muted-foreground">
              {page.status === "saving"
                ? "Building the page\u2026"
                : (page.error ?? "The page could not be saved.")}
            </div>
          )}

          <div className="mt-1.5">
            <StatusPill status={page.status} />
          </div>
        </div>
      </div>
    </div>
  );
}
